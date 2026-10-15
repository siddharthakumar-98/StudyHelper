import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createJob, runJobStep } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { MemoryJobStore } from "@/modules/jobs/store";
import { createUploadRecords, finalizeUploadRecords } from "@/modules/ingestion/uploadService";
import { createFakeAiClient } from "@/modules/ai/fake";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestUser, resetDb, serviceClient } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

const service = serviceClient();
// The handler only needs the database; the AI client is unused by split.
const deps = { ai: createFakeAiClient({}), db: service as SupabaseClient<Database> };

async function uploadFixtureDocument() {
  const admin = await createTestUser("admin");
  const pdf = await makePdf({ pages: 2 });
  const jpg = new Uint8Array(readFileSync("tests/fixtures/sample.jpg"));
  const { documentId, uploads } = await createUploadRecords(service, admin.id, {
    title: "Split fixture",
    classDate: "2026-10-15",
    files: [
      { name: "handout.pdf", type: "application/pdf", size: pdf.byteLength },
      { name: "photo.jpg", type: "image/jpeg", size: jpg.byteLength },
    ],
  });
  const bodies = [pdf, jpg];
  const types = ["application/pdf", "image/jpeg"];
  for (const ticket of uploads) {
    const { error } = await service.storage
      .from("materials")
      .uploadToSignedUrl(ticket.path, ticket.token, bodies[ticket.fileIndex], {
        contentType: types[ticket.fileIndex],
      });
    expect(error).toBeNull();
  }
  return { documentId, uploads };
}

async function pagesOf(documentId: string) {
  const { data, error } = await service
    .from("source_pages")
    .select("page_no, kind, source_file_index, storage_path")
    .eq("document_id", documentId)
    .order("page_no");
  expect(error).toBeNull();
  return data!;
}

describe("upload + split", () => {
  beforeAll(resetDb);

  it("splits a PDF plus an image into numbered pages, idempotently", async () => {
    const { documentId } = await uploadFixtureDocument();
    const store = new MemoryJobStore();
    const jobId = await createJob(store, "split", documentId, {});

    const first = await runJobStep(store, JOB_HANDLERS, jobId, deps);
    expect(first).toMatchObject({ status: "pending", progress: { current: 1, total: 2 } });
    const second = await runJobStep(store, JOB_HANDLERS, jobId, deps);
    expect(second.status).toBe("done");
    expect(second.nextJobId).not.toBeNull();
    expect((await store.get(second.nextJobId!)).kind).toBe("extract");

    const pages = await pagesOf(documentId);
    expect(pages.map((p) => [p.page_no, p.kind, p.source_file_index])).toEqual([
      [1, "pdf_page", 0],
      [2, "pdf_page", 0],
      [3, "image", 1],
    ]);
    expect(pages.map((p) => p.storage_path)).toEqual([
      `materials/${documentId}/pages/0001.pdf`,
      `materials/${documentId}/pages/0002.pdf`,
      `materials/${documentId}/pages/0003.jpg`,
    ]);
    const { data: doc } = await service
      .from("documents")
      .select("page_count, status")
      .eq("id", documentId)
      .single();
    expect(doc).toEqual({ page_count: 3, status: "processing" });

    // Every page object exists in storage.
    for (const page of pages) {
      const { data, error } = await service.storage.from("materials").download(page.storage_path);
      expect(error).toBeNull();
      expect(data!.size).toBeGreaterThan(0);
    }

    // Re-running step 0 (a duplicate job) replaces, not appends.
    const rerunStore = new MemoryJobStore();
    const rerun = await createJob(rerunStore, "split", documentId, {});
    const rerun0 = await runJobStep(rerunStore, JOB_HANDLERS, rerun, deps);
    expect(rerun0).toMatchObject({ status: "pending", error: null });
    expect(await pagesOf(documentId)).toHaveLength(3);
    const rerun1 = await runJobStep(rerunStore, JOB_HANDLERS, rerun, deps);
    expect(rerun1).toMatchObject({ status: "done", error: null });
    expect(await pagesOf(documentId)).toHaveLength(3);
  });

  it("finalize checks the files exist and creates one split job", async () => {
    const admin = await createTestUser("admin");
    const { documentId, uploads } = await createUploadRecords(service, admin.id, {
      title: "Finalize fixture",
      classDate: null,
      files: [{ name: "a.pdf", type: "application/pdf", size: 10 }],
    });
    expect(uploads).toHaveLength(1);

    // Nothing uploaded yet: refuses and creates no job.
    await expect(finalizeUploadRecords(service, documentId)).rejects.toThrow(/did not finish/);
    const { count: none } = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId);
    expect(none).toBe(0);

    const pdf = await makePdf({ pages: 1 });
    const { error } = await service.storage
      .from("materials")
      .uploadToSignedUrl(uploads[0].path, uploads[0].token, pdf, { contentType: "application/pdf" });
    expect(error).toBeNull();

    const results = await Promise.all([
      finalizeUploadRecords(service, documentId),
      finalizeUploadRecords(service, documentId),
    ]);
    const later = await finalizeUploadRecords(service, documentId);
    expect(new Set([...results.map((r) => r.jobId), later.jobId]).size).toBe(1);
    const { data: jobs } = await service
      .from("jobs")
      .select("kind")
      .eq("document_id", documentId);
    expect(jobs).toEqual([{ kind: "split" }]);
  });

  it("rejects HEIC and other types on the server", async () => {
    const admin = await createTestUser("admin");
    await expect(
      createUploadRecords(service, admin.id, {
        title: "Bad",
        classDate: null,
        files: [{ name: "a.heic", type: "image/heic", size: 10 }],
      }),
    ).rejects.toThrow(/only PDF, JPG or PNG/);
  });
});
