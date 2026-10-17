import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob, runJobStep } from "@/modules/jobs/engine";
import type { JobSnapshot, StepDeps } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { VERIFY_START_WINDOW_MS } from "@/modules/generation/handlers";
import { MemoryJobStore, SupabaseJobStore } from "@/modules/jobs/store";
import type { JobStore } from "@/modules/jobs/types";
import { startQuestionWritingRecord } from "@/modules/ingestion/slideService";
import type { AiCallInput } from "@/modules/ai/client";
import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { AiTruncatedError } from "@/modules/ai/errors";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS, type FakeResponders } from "@/modules/ai/fake";
import { processDraftQuestion, SIMILAR_STEM_THRESHOLD } from "@/modules/generation/verify";
import { createUploadRecords } from "@/modules/ingestion/uploadService";
import { pagePath } from "@/modules/ingestion/paths";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createTestUser, resetDb, serviceClient } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

const service = serviceClient();
const db = service as SupabaseClient<Database>;
const fakeDeps: StepDeps = { ai: createFakeAiClient(DEFAULT_FAKE_RESPONDERS), db };

type Status = Database["public"]["Enums"]["question_status"];

/** Distinct facts, so no two stems are near each other. */
const STEMS = [
  "What HbA1c target suits most non-pregnant adults with diabetes?",
  "Which drug class lowers hospitalisation for heart failure?",
  "When should a woman with gestational diabetes be rescreened after delivery?",
  "How much weight loss lowers progression from prediabetes to diabetes?",
  "Below which plasma glucose value does level 2 hypoglycaemia start?",
  "How is metformin titrated to limit gastrointestinal upset?",
  "Which formula estimates the insulin correction factor?",
];

async function runToEnd(store: JobStore, jobId: string, deps: StepDeps) {
  const snapshots: JobSnapshot[] = [];
  for (let i = 0; i < 40; i++) {
    const snapshot = await runJobStep(store, JOB_HANDLERS, jobId, deps);
    snapshots.push(snapshot);
    if (snapshot.status === "done" || snapshot.status === "failed") return snapshots;
  }
  throw new Error("job did not finish");
}

/** Runs a job and every job it queues; returns each job's kind and snapshots. */
async function runChain(store: JobStore, jobId: string, deps: StepDeps) {
  const jobs: { kind: string; snapshots: JobSnapshot[] }[] = [];
  let next: string | null = jobId;
  while (next) {
    const snapshots = await runToEnd(store, next, deps);
    const last = snapshots.at(-1)!;
    expect(last).toMatchObject({ status: "done", error: null });
    jobs.push({ kind: last.kind, snapshots });
    next = last.nextJobId;
  }
  return jobs;
}

/**
 * Uploads an n-page PDF and runs split → extract, then (as the admin's "Write
 * questions" does after the slide check, R38) topic_map → generate → verify.
 */
async function uploadAndRunPipeline(pages: number, deps: StepDeps) {
  const admin = await createTestUser("admin");
  const pdf = await makePdf({ pages });
  const { documentId, uploads } = await createUploadRecords(service, admin.id, {
    title: "Verify fixture",
    classDate: null,
    files: [{ name: "handout.pdf", type: "application/pdf", size: pdf.byteLength }],
  });
  const { error } = await service.storage
    .from("materials")
    .uploadToSignedUrl(uploads[0].path, uploads[0].token, pdf, { contentType: "application/pdf" });
  expect(error).toBeNull();
  const store = new MemoryJobStore();
  const reading = await runChain(store, await createJob(store, "split", documentId, {}), deps);
  expect(reading.map((j) => j.kind)).toEqual(["split", "extract"]);
  const { data: paused } = await service.from("documents").select("status").eq("id", documentId).single();
  expect(paused!.status).toBe("review");

  const { jobId } = await startQuestionWritingRecord(db, documentId);
  const jobStore = new SupabaseJobStore(db);
  const writing = await runChain(jobStore, jobId, deps);
  expect(writing.map((j) => j.kind)).toEqual(["topic_map", "generate", "verify"]);
  return documentId;
}

/**
 * A document with one page (a real PDF in storage) holding one slide with a
 * table, so verification attaches the page; a topic; and a generation run.
 */
async function fixtureRun() {
  const admin = await createTestUser("admin");
  const { data: doc, error } = await service
    .from("documents")
    .insert({ title: "Verify drafts", uploaded_by: admin.id, status: "processing" })
    .select("id")
    .single();
  expect(error).toBeNull();
  const documentId = doc!.id as string;
  const storagePath = pagePath(documentId, 1, "pdf");
  const { error: uploadError } = await service.storage
    .from("materials")
    .upload(storagePath, await makePdf({ pages: 1 }), { contentType: "application/pdf", upsert: true });
  expect(uploadError).toBeNull();
  const { data: page } = await service
    .from("source_pages")
    .insert({ document_id: documentId, page_no: 1, source_file_index: 0, kind: "pdf_page", storage_path: storagePath })
    .select("id")
    .single();
  const { data: slide, error: slideError } = await service
    .from("source_slides")
    .insert({
      page_id: page!.id,
      position_on_page: 1,
      printed_slide_no: "41",
      title: "Insulin dosing",
      verbatim_text: "C:I ratio = 500/TDD",
      tables: [{ caption: null, rows: [["Ratio", "Formula"], ["Correction factor", "1650/TDD"]] }],
      legibility: "clear",
    })
    .select("id")
    .single();
  expect(slideError).toBeNull();
  const { data: topic } = await service.from("topics").insert({ name: "Insulin dosing" }).select("id").single();
  const { data: run } = await service
    .from("generation_runs")
    .insert({ document_id: documentId })
    .select("id")
    .single();
  return {
    documentId,
    slideId: slide!.id as string,
    topicId: topic!.id as string,
    runId: run!.id as string,
  };
}

type Fixture = Awaited<ReturnType<typeof fixtureRun>>;

/** Saves one draft MCQ per stem in the run, in order (separate batches keep created_at ordered). */
async function saveDrafts(
  f: Fixture,
  drafts: { stem: string; reviewNotes?: string[]; conflictNote?: string | null; answer?: string }[],
) {
  for (const [i, draft] of drafts.entries()) {
    const item: Record<string, Json> = {
      type: "mcq",
      difficulty: "easy",
      stem: draft.stem,
      options: [
        { id: "a", text: draft.answer ?? "500/TDD" },
        { id: "b", text: "1650/TDD" },
        { id: "c", text: "1800/TDD" },
        { id: "d", text: "300/TDD" },
      ],
      source_refs: [{ documentId: f.documentId, pageNo: 1, slideId: f.slideId, label: "Slide 41" }],
      basis_quote: "C:I ratio = 500/TDD",
      conflict_note: draft.conflictNote ?? null,
      review_notes: draft.reviewNotes ?? [],
      correct_option_id: "a",
      explanation: "The slide gives 500/TDD.",
      model_answer: null,
      key_concepts: null,
      rubric: null,
    };
    const { error } = await db.rpc("save_generated_questions", {
      p_run_id: f.runId,
      p_topic_id: f.topicId,
      p_batch_key: `batch-${i}`,
      p_items: [item],
    });
    expect(error).toBeNull();
  }
}

async function questionsOfRun(runId: string) {
  const { data, error } = await db
    .from("questions")
    .select("id, status, current_version, created_at, question_versions(version, stem, review_notes, conflict_note)")
    .eq("generation_run_id", runId)
    .order("created_at")
    .order("id");
  expect(error).toBeNull();
  return data!.map((q) => ({ ...q, version: q.question_versions.find((v) => v.version === q.current_version)! }));
}

async function questionsOfDocument(documentId: string) {
  const { data: runs } = await db.from("generation_runs").select("id").eq("document_id", documentId);
  expect(runs).toHaveLength(1);
  return questionsOfRun(runs![0].id);
}

async function verify(f: Fixture, deps: StepDeps = fakeDeps) {
  const store = new MemoryJobStore();
  return runToEnd(store, await createJob(store, "verify", f.documentId, { runId: f.runId }), deps);
}

/** Wraps the default fakes and records the verify and dedup calls. */
function recordingDeps(overrides: FakeResponders = {}) {
  const calls: AiCallInput<unknown>[] = [];
  const responders: FakeResponders = { ...DEFAULT_FAKE_RESPONDERS, ...overrides };
  const ai = createFakeAiClient({
    ...responders,
    verify: (input) => {
      calls.push(input);
      return responders.verify!(input);
    },
    dedup: (input) => {
      calls.push(input);
      return responders.dedup!(input);
    },
  });
  return { calls, deps: { ai, db } satisfies StepDeps };
}

/**
 * Inserts a question directly, with one version per stem (the last is current).
 * Each version's answer is `answer` plus its version number: an MCQ's correct
 * option text, or an SAQ's model answer.
 */
async function insertQuestion(
  topicId: string,
  status: Status,
  stems: string[],
  type: "mcq" | "saq" = "mcq",
  answer = "500/TDD",
): Promise<string> {
  const { data: q, error } = await service
    .from("questions")
    .insert({ type, status, topic_id: topicId, difficulty: "easy", current_version: stems.length })
    .select("id")
    .single();
  expect(error).toBeNull();
  const { error: versionError } = await service.from("question_versions").insert(
    stems.map((stem, i) => ({
      question_id: q!.id,
      version: i + 1,
      stem,
      options: type === "mcq" ? [{ id: "a", text: "wrong" }, { id: "b", text: `${answer} v${i + 1}` }] : null,
      source_refs: [],
      basis_quote: "quote",
    })),
  );
  expect(versionError).toBeNull();
  const { error: keyError } = await service.from("answer_keys").insert(
    stems.map((_, i) => ({
      question_id: q!.id,
      version: i + 1,
      correct_option_id: type === "mcq" ? "b" : null,
      model_answer: type === "saq" ? `${answer} v${i + 1}` : null,
    })),
  );
  expect(keyError).toBeNull();
  return q!.id as string;
}

describe("find_similar_stems", () => {
  beforeEach(resetDb);

  it("finds an identical current stem with sim 1 among active, needs_review and flagged questions only", async () => {
    const { data: topic } = await service.from("topics").insert({ name: "Similarity" }).select("id").single();
    const topicId = topic!.id as string;
    const stem = "Which formula estimates the carbohydrate to insulin ratio?";
    const active = await insertQuestion(topicId, "active", [stem]);
    const review = await insertQuestion(topicId, "needs_review", [`${stem} Explain.`], "saq", "Divide 500 by TDD");
    const flagged = await insertQuestion(topicId, "flagged", [stem.replace("carbohydrate", "carb")]);
    await insertQuestion(topicId, "retired", [stem]);
    await insertQuestion(topicId, "draft", [stem]);
    const self = await insertQuestion(topicId, "active", [stem]);
    // Only the current version counts: version 1 matches, version 2 does not.
    await insertQuestion(topicId, "active", [stem, "Name two adverse effects of sulfonylureas."]);
    await insertQuestion(topicId, "active", ["Name two adverse effects of DPP-4 inhibitors."]);

    const { data, error } = await db.rpc("find_similar_stems", {
      p_stem: stem,
      p_exclude_question: self,
      p_threshold: SIMILAR_STEM_THRESHOLD,
    });
    expect(error).toBeNull();
    expect(data!.map((r) => r.question_id)).toEqual(expect.arrayContaining([active, review, flagged]));
    expect(data).toHaveLength(3);
    // Type and answer come from the current version's answer key.
    expect(data![0]).toEqual({ question_id: active, type: "mcq", stem, answer: "500/TDD v1", sim: 1 });
    expect(data!.find((r) => r.question_id === review)).toMatchObject({ type: "saq", answer: "Divide 500 by TDD v1" });
    const sims = data!.map((r) => r.sim);
    expect([...sims].sort((a, b) => b - a)).toEqual(sims);
    expect(Math.min(...sims)).toBeGreaterThanOrEqual(SIMILAR_STEM_THRESHOLD);

    // The default threshold is the app's.
    const { data: byDefault } = await db.rpc("find_similar_stems", { p_stem: stem, p_exclude_question: self });
    expect(byDefault).toEqual(data);
  });

  it("returns at most 5", async () => {
    const { data: topic } = await service.from("topics").insert({ name: "Many" }).select("id").single();
    const stem = "What is the maximum daily dose of metformin?";
    for (let i = 0; i < 7; i++) await insertQuestion(topic!.id as string, "active", [`${stem} (${i})`]);
    const { data } = await db.rpc("find_similar_stems", {
      p_stem: stem,
      p_exclude_question: "00000000-0000-4000-8000-000000000000",
      p_threshold: SIMILAR_STEM_THRESHOLD,
    });
    expect(data).toHaveLength(5);
  });
});

describe("verify stage", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks 7 drafts in two steps (5 + 2), then completes the run and marks the document ready", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, STEMS.map((stem) => ({ stem })));
    const { calls, deps } = recordingDeps();

    const snapshots = await verify(f, deps);
    expect(snapshots.map((s) => [s.status, s.progress?.label])).toEqual([
      ["pending", "Checking questions (5 of 7)"],
      ["done", "Checking questions (7 of 7)"],
    ]);
    expect(snapshots.at(-1)!.nextJobId).toBeNull();
    expect((await questionsOfRun(f.runId)).map((q) => q.status)).toEqual(Array(7).fill("active"));
    // One verifier call each (some stems may also be dedup candidates; the fake says "not a duplicate").
    const verifyCalls = calls.filter((c) => c.task === "verify");
    expect(verifyCalls).toHaveLength(7);
    // The slide has a table: its page is attached for the verifier.
    expect(verifyCalls[0].content.filter((b) => b.type === "document")).toHaveLength(1);

    const { data: run } = await db.from("generation_runs").select("completed_at").eq("id", f.runId).single();
    expect(run!.completed_at).not.toBeNull();
    const { data: doc } = await db.from("documents").select("status").eq("id", f.documentId).single();
    expect(doc!.status).toBe("ready");
  });

  it("starts no new draft once the step has run for the start window", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, STEMS.slice(0, 3).map((stem) => ({ stem })));
    // Each verifier call takes the whole window: one question per step.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    const { deps } = recordingDeps({
      verify: (input) => {
        offset += VERIFY_START_WINDOW_MS;
        return DEFAULT_FAKE_RESPONDERS.verify!(input);
      },
    });
    const snapshots = await verify(f, deps);
    expect(snapshots.map((s) => [s.status, s.progress?.label])).toEqual([
      ["pending", "Checking questions (1 of 3)"],
      ["pending", "Checking questions (2 of 3)"],
      ["done", "Checking questions (3 of 3)"],
    ]);
  });

  it("asks the model, not the auto rule, about identical generic stems with different answers", async () => {
    const f = await fixtureRun();
    const stem = "Which statement about SGLT2 inhibitors is correct?";
    await saveDrafts(f, [
      { stem, answer: "They reduce hospitalisation for heart failure" },
      { stem, answer: "They slow the progression of chronic kidney disease" },
    ]);
    const { calls, deps } = recordingDeps();
    await verify(f, deps);
    expect(calls.filter((c) => c.task === "dedup")).toHaveLength(1);
    expect((await questionsOfRun(f.runId)).map((q) => q.status)).toEqual(["active", "active"]);
  });

  it("follows the fake verifier: a FAIL stem goes to needs_review with notes", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: STEMS[0] }, { stem: `${STEMS[1]} FAIL` }, { stem: STEMS[2] }]);
    await verify(f);
    const questions = await questionsOfRun(f.runId);
    expect(questions.map((q) => q.status)).toEqual(["active", "needs_review", "active"]);
    expect(questions[0].version.review_notes).toEqual([]);
    expect(questions[1].version.review_notes.length).toBeGreaterThan(0);
    expect(questions[1].version.review_notes.every((n) => n.startsWith("Verifier: "))).toBe(true);
  });

  it("appends the verifier's guideline conflict to the version's conflict note", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: STEMS[0], conflictNote: "Slide 41 says 500/TDD; Slide 86 says 450/TDD." }]);
    const { deps } = recordingDeps({
      verify: (input) => ({
        ...(DEFAULT_FAKE_RESPONDERS.verify!(input) as object),
        guideline_conflict: "The slide says 500/TDD; some current guidance uses 450/TDD.",
      }),
    });
    await verify(f, deps);
    const [q] = await questionsOfRun(f.runId);
    expect(q.status).toBe("active");
    expect(q.version.conflict_note).toBe(
      "Slide 41 says 500/TDD; Slide 86 says 450/TDD.\n\nThe slide says 500/TDD; some current guidance uses 450/TDD.",
    );
  });

  it("sends a draft with an Auto-check note to needs_review without calling the verifier", async () => {
    const f = await fixtureRun();
    const autoCheck = "Auto-check: Basis quote not found in cited slide";
    await saveDrafts(f, [{ stem: STEMS[0], reviewNotes: [autoCheck] }]);
    const { calls, deps } = recordingDeps();
    await verify(f, deps);
    const [q] = await questionsOfRun(f.runId);
    expect(q.status).toBe("needs_review");
    expect(q.version.review_notes).toEqual([autoCheck]);
    expect(calls).toHaveLength(0);
  });

  it("is safe to re-run: checked questions are not reprocessed and notes are not appended twice", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: STEMS[0] }, { stem: `${STEMS[1]} FAIL` }]);
    await verify(f);
    const before = await questionsOfRun(f.runId);

    // A duplicate verify job, and a direct re-check of an already-checked question.
    const { calls, deps } = recordingDeps();
    const again = await verify(f, deps);
    expect(again.at(-1)).toMatchObject({ status: "done", error: null });
    expect(await processDraftQuestion(before[1].id, { ...deps, documentId: f.documentId })).toBe("needs_review");
    expect(calls).toHaveLength(0);
    expect(await questionsOfRun(f.runId)).toEqual(before);
  });

  it("(Review Focus 3) a second handout that repeats the first's questions retires the repeats", async () => {
    // Document A: 7 slides → one topic in two batches → 4 questions, all distinct.
    const docA = await uploadAndRunPipeline(7, fakeDeps);
    const a = await questionsOfDocument(docA);
    expect(a).toHaveLength(4);
    expect(a.map((q) => q.status)).toEqual(Array(4).fill("active"));

    // Document B's generator writes exactly A's stems (no document prefix).
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      generate: (input) => {
        const result = DEFAULT_FAKE_RESPONDERS.generate!(input) as {
          mcqs: { stem: string }[];
          saqs: { stem: string }[];
        };
        const withADoc = (q: { stem: string }) => ({
          ...q,
          stem: q.stem.replace(/^\[doc [0-9a-f]{8}\]/, `[doc ${docA.slice(0, 8)}]`),
        });
        return { ...result, mcqs: result.mcqs.map(withADoc), saqs: result.saqs.map(withADoc) };
      },
    });
    const docB = await uploadAndRunPipeline(7, { ai, db });
    const b = await questionsOfDocument(docB);
    const aByStem = new Map(a.map((q) => [q.version.stem, q.id]));
    expect(b).toHaveLength(4);
    for (const q of b) {
      expect(aByStem.has(q.version.stem)).toBe(true);
      expect(q.status).toBe("retired");
      expect(q.version.review_notes).toEqual([
        `Duplicate of ${aByStem.get(q.version.stem)}: Same type and answer, nearly identical wording (similarity 1.00)`,
      ]);
    }

    const { count } = await db.from("questions").select("id", { count: "exact", head: true }).eq("status", "active");
    expect(count).toBe(a.length);
    const { data: topics } = await db.from("topics").select("name");
    expect(topics).toEqual([{ name: "Fixture topic" }]);
    const { data: docs } = await db.from("documents").select("status").in("id", [docA, docB]);
    expect(docs!.map((d) => d.status)).toEqual(["ready", "ready"]);
  });

  it("(Review Focus 4) a truncated verifier answer is retried and ends like a clean run", async () => {
    const drafts = [{ stem: STEMS[0] }, { stem: `${STEMS[1]} FAIL` }, { stem: STEMS[2] }, { stem: STEMS[3] }];
    const outcome = async (questions: Awaited<ReturnType<typeof questionsOfRun>>) =>
      questions.map((q) => [q.version.stem, q.status, q.version.review_notes, q.version.conflict_note]);

    const clean = await fixtureRun();
    await saveDrafts(clean, drafts);
    await verify(clean);
    const expected = await outcome(await questionsOfRun(clean.runId));

    await resetDb();
    const flaky = await fixtureRun();
    await saveDrafts(flaky, drafts);
    let verifyCalls = 0;
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      verify: (input) => {
        verifyCalls += 1;
        // The third question's first check is truncated, after two were already checked.
        if (verifyCalls === 3) throw new AiTruncatedError();
        return DEFAULT_FAKE_RESPONDERS.verify!(input);
      },
    });
    const snapshots = await verify(flaky, { ai, db });
    expect(snapshots[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(snapshots[0].error).toMatch(/truncated/);
    expect(snapshots.at(-1)).toMatchObject({ status: "done", error: null });
    expect(await outcome(await questionsOfRun(flaky.runId))).toEqual(expected);
    expect(verifyCalls).toBe(5);
  });
  it("(R37) a draft whose check keeps failing goes to review on the job's last attempt; the rest finish", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: STEMS[0] }, { stem: `${STEMS[1]} STUCK` }, { stem: STEMS[2] }]);
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      verify: (input) => {
        if (String(input.meta?.stem).includes("STUCK")) throw new AiTruncatedError();
        return DEFAULT_FAKE_RESPONDERS.verify!(input);
      },
    });

    const snapshots = await verify(f, { ai, db });
    // Attempts 1 and 2 retry as usual; attempt 3 sets the stuck draft aside and carries on.
    expect(snapshots.map((s) => [s.status, s.attempts])).toEqual([
      ["pending", 1],
      ["pending", 2],
      ["done", 0],
    ]);
    expect(snapshots[0].error).toMatch(/truncated/);
    expect(snapshots.at(-1)!.error).toBeNull();

    const questions = await questionsOfRun(f.runId);
    expect(questions.map((q) => q.status)).toEqual(["active", "needs_review", "active"]);
    expect(questions[1].version.review_notes).toEqual([
      "Automatic check could not finish: the AI's answer was cut off",
    ]);
    const { data: doc } = await db.from("documents").select("status").eq("id", f.documentId).single();
    expect(doc!.status).toBe("ready");
  });

  it("(R37) a check that times out on the last attempt is set aside the same way", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: `${STEMS[0]} SLOW` }, { stem: STEMS[1] }]);
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      verify: (input) => {
        if (String(input.meta?.stem).includes("SLOW")) throw new APIConnectionTimeoutError();
        return DEFAULT_FAKE_RESPONDERS.verify!(input);
      },
    });
    const snapshots = await verify(f, { ai, db });
    expect(snapshots.at(-1)).toMatchObject({ status: "done", error: null });
    const questions = await questionsOfRun(f.runId);
    expect(questions.map((q) => q.status)).toEqual(["needs_review", "active"]);
    expect(questions[0].version.review_notes).toEqual([
      "Automatic check could not finish: the AI took too long to answer",
    ]);
  });

  it("(R37) an error that is not the AI's still fails the job after three attempts", async () => {
    const f = await fixtureRun();
    await saveDrafts(f, [{ stem: STEMS[0] }]);
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      verify: () => {
        throw new Error("database went away");
      },
    });
    const snapshots = await verify(f, { ai, db });
    expect(snapshots.at(-1)).toMatchObject({ status: "failed", attempts: 3 });
    expect((await questionsOfRun(f.runId)).map((q) => q.status)).toEqual(["draft"]);
  });
});
