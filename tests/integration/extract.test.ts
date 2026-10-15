import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob, runJobStep } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { MemoryJobStore } from "@/modules/jobs/store";
import type { JobSnapshot, StepDeps } from "@/modules/jobs/engine";
import { createUploadRecords } from "@/modules/ingestion/uploadService";
import { slideLabel } from "@/modules/ingestion/slideLabel";
import type { AiClient } from "@/modules/ai/client";
import { AiTruncatedError } from "@/modules/ai/errors";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "@/modules/ai/fake";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, resetDb, serviceClient } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

const service = serviceClient();
const db = service as SupabaseClient<Database>;
const fakeDeps: StepDeps = { ai: createFakeAiClient(DEFAULT_FAKE_RESPONDERS), db };

async function runToEnd(store: MemoryJobStore, jobId: string, deps: StepDeps) {
  const snapshots: JobSnapshot[] = [];
  for (let i = 0; i < 20; i++) {
    const snapshot = await runJobStep(store, JOB_HANDLERS, jobId, deps);
    snapshots.push(snapshot);
    if (snapshot.status === "done" || snapshot.status === "failed") return snapshots;
  }
  throw new Error("job did not finish");
}

/** Uploads a 2-page PDF and splits it, so the document has 2 source_pages. */
async function splitTwoPageDocument(): Promise<string> {
  const admin = await createTestUser("admin");
  const pdf = await makePdf({ pages: 2 });
  const { documentId, uploads } = await createUploadRecords(service, admin.id, {
    title: "Extract fixture",
    classDate: null,
    files: [{ name: "handout.pdf", type: "application/pdf", size: pdf.byteLength }],
  });
  const { error } = await service.storage
    .from("materials")
    .uploadToSignedUrl(uploads[0].path, uploads[0].token, pdf, { contentType: "application/pdf" });
  expect(error).toBeNull();
  const store = new MemoryJobStore();
  const split = await runToEnd(store, await createJob(store, "split", documentId, {}), fakeDeps);
  expect(split.at(-1)?.status).toBe("done");
  return documentId;
}

async function slidesOf(documentId: string) {
  const { data, error } = await service
    .from("source_slides")
    .select(
      "position_on_page, printed_slide_no, verbatim_text, legibility, source_pages!inner(page_no, document_id)",
    )
    .eq("source_pages.document_id", documentId);
  expect(error).toBeNull();
  return (data ?? [])
    .map((row) => {
      const { source_pages: page, ...slide } = row as typeof row & {
        source_pages: { page_no: number };
      };
      return { ...slide, page_no: page.page_no };
    })
    .sort((a, b) => a.page_no - b.page_no || a.position_on_page - b.position_on_page);
}

async function extractAll(documentId: string, deps: StepDeps = fakeDeps) {
  const store = new MemoryJobStore();
  const jobId = await createJob(store, "extract", documentId, {});
  return { store, snapshots: await runToEnd(store, jobId, deps) };
}

describe("extract stage", () => {
  beforeAll(resetDb);

  it("reads every page into slides, then hands over to topic_map", async () => {
    const documentId = await splitTwoPageDocument();
    const { store, snapshots } = await extractAll(documentId);

    expect(snapshots.map((s) => s.progress)).toEqual([
      { current: 1, total: 2, label: "Reading page 1 of 2" },
      { current: 2, total: 2, label: "Reading page 2 of 2" },
    ]);
    const last = snapshots.at(-1)!;
    expect(last).toMatchObject({ status: "done", error: null });
    expect((await store.get(last.nextJobId!)).kind).toBe("topic_map");

    const slides = await slidesOf(documentId);
    expect(slides).toEqual([
      {
        page_no: 1,
        position_on_page: 1,
        printed_slide_no: "1",
        legibility: "clear",
        verbatim_text: "Fixture slide text for page 1. Metformin 500 mg.",
      },
      {
        page_no: 2,
        position_on_page: 1,
        printed_slide_no: "2",
        legibility: "clear",
        verbatim_text: "Fixture slide text for page 2. Metformin 500 mg.",
      },
    ]);

    // Re-running step 0 (a duplicate job) replaces that page's slides, not appends.
    const rerunStore = new MemoryJobStore();
    const rerun = await createJob(rerunStore, "extract", documentId, {});
    const rerun0 = await runJobStep(rerunStore, JOB_HANDLERS, rerun, fakeDeps);
    expect(rerun0).toMatchObject({ status: "pending", error: null });
    expect(await slidesOf(documentId)).toHaveLength(2);
  });

  it("keeps two unnumbered photos on one page as distinct slides", async () => {
    const documentId = await splitTwoPageDocument();
    const unnumbered = {
      printed_slide_no: null,
      title: null,
      tables: [],
      diagram_description: null,
      legibility: "clear",
      uncertain_terms: [],
      cropped: false,
    };
    const ai = createFakeAiClient({
      // Both photos come back claiming position 1; the stage must still keep both.
      extract: () => ({
        slides: [
          { ...unnumbered, position_on_page: 1, verbatim_text: "Diabetic neuropathy" },
          { ...unnumbered, position_on_page: 1, verbatim_text: "Foot examination" },
        ],
      }),
    });
    await extractAll(documentId, { ai, db });

    const page1 = (await slidesOf(documentId)).filter((s) => s.page_no === 1);
    expect(page1.map((s) => [s.position_on_page, s.verbatim_text])).toEqual([
      [1, "Diabetic neuropathy"],
      [2, "Foot examination"],
    ]);
    const labels = page1.map(slideLabel);
    expect(labels).toEqual(["Page 1, photo 1", "Page 1, photo 2"]);
    expect(new Set(labels).size).toBe(2);
  });

  it("retries a truncated AI answer without leaving partial rows", async () => {
    const documentId = await splitTwoPageDocument();
    const fake = createFakeAiClient(DEFAULT_FAKE_RESPONDERS);
    let calls = 0;
    const flaky: AiClient = {
      callStructured(input) {
        calls += 1;
        if (calls === 1) throw new AiTruncatedError();
        return fake.callStructured(input);
      },
    };
    const store = new MemoryJobStore();
    const jobId = await createJob(store, "extract", documentId, {});

    const failed = await runJobStep(store, JOB_HANDLERS, jobId, { ai: flaky, db });
    expect(failed).toMatchObject({ status: "pending", error: expect.stringMatching(/truncated/) });
    expect(await slidesOf(documentId)).toHaveLength(0);

    const rest = await runToEnd(store, jobId, { ai: flaky, db });
    expect(rest.at(-1)).toMatchObject({ status: "done", error: null });
    const slides = await slidesOf(documentId);
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => s.page_no)).toEqual([1, 2]);
  });

  it("a late duplicate split never deletes extracted slides", async () => {
    const documentId = await splitTwoPageDocument();
    await extractAll(documentId);
    expect(await slidesOf(documentId)).toHaveLength(2);
    await service.from("documents").update({ status: "ready" }).eq("id", documentId);

    const store = new MemoryJobStore();
    const jobId = await createJob(store, "split", documentId, {});
    const snapshot = await runJobStep(store, JOB_HANDLERS, jobId, fakeDeps);

    expect(snapshot).toMatchObject({ status: "done", error: null, nextJobId: null });
    expect(await slidesOf(documentId)).toHaveLength(2);
    const { count: pages } = await service
      .from("source_pages")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId);
    expect(pages).toBe(2);
    const { data: doc } = await service
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .single();
    expect(doc).toEqual({ status: "ready" });
  });
});
