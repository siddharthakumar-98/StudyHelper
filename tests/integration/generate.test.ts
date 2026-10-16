import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob, runJobStep } from "@/modules/jobs/engine";
import type { JobSnapshot, StepDeps } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { MemoryJobStore } from "@/modules/jobs/store";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS, type FakeResponders } from "@/modules/ai/fake";
import type { AiCallInput } from "@/modules/ai/client";
import { pagePath } from "@/modules/ingestion/paths";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, resetDb, serviceClient } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

const service = serviceClient();
const db = service as SupabaseClient<Database>;
const fakeDeps: StepDeps = { ai: createFakeAiClient(DEFAULT_FAKE_RESPONDERS), db };

type Legibility = "clear" | "partial" | "unreadable";

/**
 * A one-page document (the page is a real PDF in storage) with the given slides.
 * Slide 2 has a table, so generation attaches the page.
 */
async function fixtureDocument(legibilities: Legibility[]): Promise<{
  documentId: string;
  slideIds: string[];
  pageId: string;
}> {
  const admin = await createTestUser("admin");
  const { data: doc, error } = await service
    .from("documents")
    .insert({ title: "Generate fixture", uploaded_by: admin.id })
    .select("id")
    .single();
  expect(error).toBeNull();
  const documentId = doc!.id as string;
  const storagePath = pagePath(documentId, 1, "pdf");
  const { error: uploadError } = await service.storage
    .from("materials")
    .upload(storagePath, await makePdf({ pages: 1 }), { contentType: "application/pdf", upsert: true });
  expect(uploadError).toBeNull();
  const { data: page, error: pageError } = await service
    .from("source_pages")
    .insert({ document_id: documentId, page_no: 1, source_file_index: 0, kind: "pdf_page", storage_path: storagePath })
    .select("id")
    .single();
  expect(pageError).toBeNull();
  const { data: slides, error: slideError } = await service
    .from("source_slides")
    .insert(
      legibilities.map((legibility, i) => ({
        page_id: page!.id,
        position_on_page: i + 1,
        printed_slide_no: String(i + 1),
        title: `Slide title ${i + 1}`,
        verbatim_text: `• Text of slide ${i + 1}: metformin 500 mg twice daily.`,
        tables: i === 1 ? [{ caption: null, rows: [["Drug", "Dose"], ["Metformin", "500 mg"]] }] : [],
        legibility,
      })),
    )
    .select("id, position_on_page");
  expect(slideError).toBeNull();
  const slideIds = [...slides!]
    .sort((a, b) => a.position_on_page - b.position_on_page)
    .map((s) => s.id as string);
  return { documentId, slideIds, pageId: page!.id as string };
}

async function runToEnd(store: MemoryJobStore, jobId: string, deps: StepDeps) {
  const snapshots: JobSnapshot[] = [];
  for (let i = 0; i < 20; i++) {
    const snapshot = await runJobStep(store, JOB_HANDLERS, jobId, deps);
    snapshots.push(snapshot);
    if (snapshot.status === "done" || snapshot.status === "failed") return snapshots;
  }
  throw new Error("job did not finish");
}

/** Runs topic_map; returns the store and the generate job it queued. */
async function topicMap(documentId: string, deps: StepDeps = fakeDeps) {
  const store = new MemoryJobStore();
  const snapshot = await runJobStep(store, JOB_HANDLERS, await createJob(store, "topic_map", documentId, {}), deps);
  expect(snapshot).toMatchObject({ status: "done", error: null });
  const generateJob = await store.get(snapshot.nextJobId!);
  expect(generateJob.kind).toBe("generate");
  return { store, generateJobId: generateJob.id, runId: (generateJob.payload as { runId: string }).runId };
}

/** Runs one generate step in a fresh job (as a retry or a duplicate job would). */
async function generateOnce(documentId: string, runId: string, deps: StepDeps = fakeDeps) {
  const store = new MemoryJobStore();
  return runJobStep(store, JOB_HANDLERS, await createJob(store, "generate", documentId, { runId }), deps);
}

async function questionsOf(runId: string) {
  const { data, error } = await db
    .from("questions")
    .select(
      "id, type, status, difficulty, current_version, topic_id, batch_key, question_versions(version, stem, options, source_refs, basis_quote, conflict_note, review_notes, answer_keys(correct_option_id, explanation, model_answer, key_concepts, rubric))",
    )
    .eq("generation_run_id", runId)
    .order("created_at");
  expect(error).toBeNull();
  return data!;
}

async function topicId(name: string): Promise<string> {
  const { data } = await service.from("topics").select("id").eq("name", name).single();
  return data!.id as string;
}

/** Wraps the default generate fake and records each call it answers. */
function recordingDeps() {
  const calls: AiCallInput<unknown>[] = [];
  const responders: FakeResponders = {
    ...DEFAULT_FAKE_RESPONDERS,
    generate: (input) => {
      calls.push(input);
      return DEFAULT_FAKE_RESPONDERS.generate!(input);
    },
  };
  return { calls, deps: { ai: createFakeAiClient(responders), db } satisfies StepDeps };
}

const textOf = (input: AiCallInput<unknown>) =>
  input.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

describe("generate stage", () => {
  beforeEach(resetDb);

  it("writes 2 draft questions per batch, each with version 1 and a key, then hands over to verify", async () => {
    // 7 readable slides -> batches of 6 and 1; the unreadable slide is left out.
    const { documentId, slideIds } = await fixtureDocument([
      "clear", "clear", "partial", "clear", "clear", "clear", "clear", "unreadable",
    ]);
    const { store, generateJobId, runId } = await topicMap(documentId);
    const { calls, deps } = recordingDeps();

    const snapshots = await runToEnd(store, generateJobId, deps);
    expect(snapshots.map((s) => s.progress?.label)).toEqual([
      "Writing questions: Fixture topic (1 of 2)",
      "Writing questions: Fixture topic (2 of 2)",
    ]);
    const last = snapshots.at(-1)!;
    expect(last).toMatchObject({ status: "done", error: null });
    const next = await store.get(last.nextJobId!);
    expect(next.kind).toBe("verify");
    expect(next.payload).toEqual({ runId });

    const topic = await topicId("Fixture topic");
    const questions = await questionsOf(runId);
    expect(questions).toHaveLength(4);
    expect(questions.map((q) => [q.type, q.batch_key])).toEqual([
      ["mcq", `${topic}:0`],
      ["saq", `${topic}:0`],
      ["mcq", `${topic}:1`],
      ["saq", `${topic}:1`],
    ]);
    for (const q of questions) {
      expect(q).toMatchObject({ status: "draft", current_version: 1, topic_id: topic });
      expect(q.question_versions).toHaveLength(1);
      const version = q.question_versions[0];
      expect(version.version).toBe(1);
      expect(version.review_notes).toEqual([]);
      expect(version.stem).toContain(`[doc ${documentId.slice(0, 8)}]`);
      // One key per version (its primary key is the version's), so it embeds as an object.
      const key = version.answer_keys!;
      expect(key).toBeTruthy();
      if (q.type === "mcq") {
        expect(version.options).toHaveLength(4);
        expect(key.correct_option_id).toBe("a");
        expect(key.explanation).toBeTruthy();
      } else {
        expect(version.options).toBeNull();
        expect(key.model_answer).toBeTruthy();
        expect((key.rubric as { criteria: unknown[] }).criteria).toHaveLength(3);
      }
    }
    // Batch 0 cites the first slide; batch 1 holds slide 7 only.
    expect(questions[0].question_versions[0].source_refs).toEqual([
      { documentId, pageNo: 1, slideId: slideIds[0], label: "Slide 1" },
    ]);
    expect(questions[2].question_versions[0].source_refs).toEqual([
      { documentId, pageNo: 1, slideId: slideIds[6], label: "Slide 7" },
    ]);

    // Batch 0 has the table slide, so its page is attached once; batch 1 needs no page.
    expect(calls).toHaveLength(2);
    expect(calls[0].content.filter((b) => b.type === "document")).toHaveLength(1);
    expect(calls[1].content.filter((b) => b.type !== "text")).toHaveLength(0);
    expect(textOf(calls[0])).not.toContain("Text of slide 8");
    // Batch 1 is told to avoid the stems batch 0 just wrote.
    expect(textOf(calls[1])).toContain(questions[0].question_versions[0].stem);
    // Each batch sees the topic's other readable slides as read-only context.
    expect(textOf(calls[1])).toContain("(C1) Slide 1");
    expect(textOf(calls[1])).toContain("(C6) Slide 6");
    expect(textOf(calls[0])).toContain("(C1) Slide 7");
    expect(textOf(calls[0])).not.toContain("Slide 8");
  });

  it("re-running a batch replaces its drafts instead of adding to them", async () => {
    const { documentId } = await fixtureDocument(["clear", "clear"]);
    const { store, generateJobId, runId } = await topicMap(documentId);
    await runToEnd(store, generateJobId, fakeDeps);
    const first = await questionsOf(runId);
    expect(first).toHaveLength(2);

    const { calls, deps } = recordingDeps();
    const again = await generateOnce(documentId, runId, deps);
    expect(again).toMatchObject({ error: null });
    const second = await questionsOf(runId);
    expect(second).toHaveLength(2);
    expect(second.map((q) => q.id)).not.toEqual(first.map((q) => q.id));
    // The batch's own earlier drafts are not "stems to avoid": they are being replaced.
    expect(textOf(calls[0])).not.toContain(first[0].question_versions[0].stem);
  });

  it("saves a question that fails a pre-check as a draft with an Auto-check note", async () => {
    const { documentId } = await fixtureDocument(["clear"]);
    const { store, generateJobId, runId } = await topicMap(documentId);
    const ai = createFakeAiClient({
      generate: () => ({
        mcqs: [
          {
            stem: "What is the starting dose of metformin?",
            options: [
              { id: "a", text: "250 mg" },
              { id: "b", text: "500 mg" },
              { id: "c", text: "850 mg" },
              { id: "d", text: "None of the above" },
            ],
            correct_option_id: "a",
            explanation: "Invented.",
            difficulty: "easy",
            source_slide_ids: ["S1"],
            basis_quote: "Start metformin at 250 mg",
            conflict_note: null,
          },
        ],
        saqs: [],
        skipped_slides: [],
      }),
    });
    const snapshots = await runToEnd(store, generateJobId, { ai, db });
    expect(snapshots.at(-1)).toMatchObject({ status: "done", error: null });

    const questions = await questionsOf(runId);
    expect(questions).toHaveLength(1);
    expect(questions[0].status).toBe("draft");
    expect(questions[0].question_versions[0].review_notes).toEqual([
      "Auto-check: Options must not use 'all/none of the above'",
      "Auto-check: Basis quote not found in cited slide",
    ]);
  });

  it("step 0 removes the run's drafts from batches no longer in the plan, keeping checked questions", async () => {
    const { documentId } = await fixtureDocument(["clear", "clear"]);
    const first = await topicMap(documentId);
    await runToEnd(first.store, first.generateJobId, fakeDeps);
    const before = await questionsOf(first.runId);
    expect(before).toHaveLength(2);
    // One question was already verified in the earlier pass.
    await service.from("questions").update({ status: "active" }).eq("id", before[0].id);

    // A new topic-map pass moves the slides to another topic; the open run is reused.
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      topicMap: () => ({ topics: [{ name: "Other topic", slide_ids: ["S1", "S2"] }], unassigned: [] }),
    });
    const second = await topicMap(documentId, { ai, db });
    expect(second.runId).toBe(first.runId);
    await runToEnd(second.store, second.generateJobId, { ai, db });

    const other = await topicId("Other topic");
    const after = await questionsOf(first.runId);
    expect(after.map((q) => q.id)).toContain(before[0].id); // the active one stays
    expect(after.map((q) => q.id)).not.toContain(before[1].id); // the stale draft is gone
    expect(after.filter((q) => q.status === "draft").map((q) => q.batch_key)).toEqual([
      `${other}:0`,
      `${other}:0`,
    ]);
  });

  it("the finishing step removes drafts of batches the plan lost mid-run", async () => {
    const seven: Legibility[] = ["clear", "clear", "clear", "clear", "clear", "clear", "clear"];
    const { documentId } = await fixtureDocument(seven);
    const { store, generateJobId, runId } = await topicMap(documentId);
    const fixture = await topicId("Fixture topic");

    // Step 0 of 2 writes batch 0 of "Fixture topic".
    const step0 = await runJobStep(store, JOB_HANDLERS, generateJobId, fakeDeps);
    expect(step0).toMatchObject({ status: "pending", error: null });
    expect((await questionsOf(runId)).map((q) => q.batch_key)).toEqual([`${fixture}:0`, `${fixture}:0`]);

    // Mid-run, a topic-map pass moves the slides to another topic (same open run).
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      topicMap: () => ({
        topics: [{ name: "Other topic", slide_ids: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] }],
        unassigned: [],
      }),
    });
    expect((await topicMap(documentId, { ai, db })).runId).toBe(runId);

    // The original job's last step writes batch 1 of the new plan and clears the stale batch.
    const step1 = await runJobStep(store, JOB_HANDLERS, generateJobId, fakeDeps);
    expect(step1).toMatchObject({ status: "done", error: null });
    const other = await topicId("Other topic");
    expect((await questionsOf(runId)).map((q) => q.batch_key)).toEqual([`${other}:1`, `${other}:1`]);
  });

  it("goes straight to verify when the handout has no topics", async () => {
    const { documentId } = await fixtureDocument(["unreadable"]);
    const { store, generateJobId, runId } = await topicMap(documentId);
    const [snapshot] = await runToEnd(store, generateJobId, fakeDeps);
    expect(snapshot).toMatchObject({ status: "done", error: null });
    expect(snapshot.progress?.label).toBe("No topics to write questions for");
    expect((await store.get(snapshot.nextJobId!)).kind).toBe("verify");
    expect(await questionsOf(runId)).toHaveLength(0);
  });
});
