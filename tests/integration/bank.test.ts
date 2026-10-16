import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AiCallInput } from "@/modules/ai/client";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS, type FakeResponders } from "@/modules/ai/fake";
import { createTestUser, resetDb, serviceClient, signedInClient } from "./helpers";

// The server actions read the session from Next's cookies(); the tests stand in
// for that with whichever signed-in client `session.client` holds, so the real
// requireUser/requireAdmin and the real row level security both apply.
const { session } = vi.hoisted(() => ({ session: { client: null as unknown } }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => session.client }));
process.env.AI_FAKE = "1";

const { ForbiddenError } = await import("@/lib/auth");
const actions = await import("@/modules/bank/actions");
const { getQuestionDetail, listQuestions } = await import("@/modules/bank/repository");
const { regenerateRecord, BankError } = await import("@/modules/bank/bankService");

const service = serviceClient();
const db = service as SupabaseClient<Database>;

type Status = Database["public"]["Enums"]["question_status"];
type Account = { email: string; password: string; id: string };

let admin: Account;
let student: Account;
let adminClient: SupabaseClient;
let studentClient: SupabaseClient;

const asAdmin = () => void (session.client = adminClient);
const asStudent = () => void (session.client = studentClient);

type Fixture = Awaited<ReturnType<typeof makeFixture>>;
let f: Fixture;
let seeded = 0;

/** A handout with a numbered slide (42, page 14) and an unnumbered one, a topic and a run. */
async function makeFixture(title = "Bank fixture") {
  const { data: doc } = await service.from("documents").insert({ title, status: "ready" }).select("id").single();
  const documentId = doc!.id as string;
  const { data: page14 } = await service
    .from("source_pages")
    .insert({ document_id: documentId, page_no: 14, source_file_index: 0, kind: "pdf_page", storage_path: `${documentId}/14.pdf` })
    .select("id")
    .single();
  const { data: slide } = await service
    .from("source_slides")
    .insert({
      page_id: page14!.id,
      position_on_page: 1,
      printed_slide_no: "42",
      title: "Insulin dosing",
      verbatim_text: "C:I ratio = 500/TDD",
      legibility: "clear",
    })
    .select("id")
    .single();
  const { data: topic } = await service.from("topics").insert({ name: `Insulin dosing ${title}` }).select("id").single();
  const { data: run } = await service.from("generation_runs").insert({ document_id: documentId }).select("id").single();
  return {
    documentId,
    slideId: slide!.id as string,
    topicId: topic!.id as string,
    runId: run!.id as string,
    topicName: `Insulin dosing ${title}`,
  };
}

type SeedOptions = {
  type?: "mcq" | "saq";
  status?: Status;
  stem?: string;
  difficulty?: "easy" | "medium" | "hard";
  conflictNote?: string | null;
  reviewNotes?: string[];
  fixture?: Fixture;
};

/** One question (version 1 with its key), in the given status. */
async function seedQuestion(opts: SeedOptions = {}): Promise<string> {
  const fx = opts.fixture ?? f;
  const type = opts.type ?? "mcq";
  const item: Record<string, Json> = {
    type,
    difficulty: opts.difficulty ?? "easy",
    stem: opts.stem ?? `Which ratio estimates the carbohydrate-to-insulin dose? (${++seeded})`,
    options:
      type === "mcq"
        ? [
            { id: "a", text: "500/TDD" },
            { id: "b", text: "1650/TDD" },
            { id: "c", text: "1800/TDD" },
            { id: "d", text: "300/TDD" },
          ]
        : null,
    source_refs: [{ documentId: fx.documentId, pageNo: 14, slideId: fx.slideId, label: "Slide 42" }],
    basis_quote: "C:I ratio = 500/TDD",
    conflict_note: opts.conflictNote ?? null,
    review_notes: opts.reviewNotes ?? [],
    correct_option_id: type === "mcq" ? "a" : null,
    explanation: type === "mcq" ? "The slide gives 500/TDD." : null,
    model_answer: type === "saq" ? "The C:I ratio is 500 divided by the total daily dose." : null,
    key_concepts: type === "saq" ? [{ concept: "500/TDD", equivalents: ["500 over TDD"] }] : null,
    rubric:
      type === "saq"
        ? {
            criteria: [
              { id: "c1", statement: "Names 500", weight: 2, equivalents: [], partial_credit_examples: [] },
              { id: "c2", statement: "Divides by TDD", weight: 1.5, equivalents: [], partial_credit_examples: [] },
              { id: "c3", statement: "Gives the unit", weight: 1.5, equivalents: [], partial_credit_examples: [] },
            ],
            critical_errors: [{ id: "e1", statement: "Uses 1800" }],
          }
        : null,
  };
  const batchKey = `seed-${++seeded}`;
  const { error } = await db.rpc("save_generated_questions", {
    p_run_id: fx.runId,
    p_topic_id: fx.topicId,
    p_batch_key: batchKey,
    p_items: [item],
  });
  expect(error).toBeNull();
  const { data: q } = await service.from("questions").select("id").eq("batch_key", batchKey).single();
  const { error: statusError } = await service
    .from("questions")
    .update({ status: opts.status ?? "needs_review" })
    .eq("id", q!.id);
  expect(statusError).toBeNull();
  return q!.id as string;
}

async function statusOf(id: string) {
  const { data } = await service.from("questions").select("status, current_version").eq("id", id).single();
  return data!;
}

async function version(id: string, n: number) {
  const { data } = await db
    .from("question_versions")
    .select("stem, review_notes, options, answer_keys(correct_option_id, explanation, model_answer, rubric)")
    .eq("question_id", id)
    .eq("version", n)
    .maybeSingle();
  return data;
}

const MCQ_EDIT = {
  stem: "Which formula estimates the carbohydrate-to-insulin ratio?",
  difficulty: "medium" as const,
};

beforeAll(async () => {
  admin = await createTestUser("admin");
  student = await createTestUser("student");
  adminClient = await signedInClient(admin.email, admin.password);
  studentClient = await signedInClient(student.email, student.password);
});

beforeEach(async () => {
  await resetDb();
  f = await makeFixture();
  asAdmin();
});

describe("approve and reject", () => {
  it("approveQuestion moves needs_review to active", async () => {
    const id = await seedQuestion({ status: "needs_review" });
    await actions.approveQuestion(id);
    expect((await statusOf(id)).status).toBe("active");
  });

  it("a student calling approveQuestion is forbidden and nothing changes", async () => {
    const id = await seedQuestion({ status: "needs_review" });
    asStudent();
    await expect(actions.approveQuestion(id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await statusOf(id)).status).toBe("needs_review");
  });

  it("every admin action refuses a student", async () => {
    const id = await seedQuestion({ status: "active" });
    asStudent();
    await expect(actions.rejectQuestion(id, "no")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(actions.editQuestion(id, MCQ_EDIT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(actions.regenerateQuestion(id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 1 });
  });

  it("rejectQuestion retires the question and appends 'Rejected: <reason>'", async () => {
    const id = await seedQuestion({ status: "needs_review", reviewNotes: ["Verifier: first note"] });
    await actions.rejectQuestion(id, "  The slide does not say this  ");
    expect((await statusOf(id)).status).toBe("retired");
    expect((await version(id, 1))!.review_notes).toEqual([
      "Verifier: first note",
      "Rejected: The slide does not say this",
    ]);
  });

  it("rejectQuestion needs a reason", async () => {
    const id = await seedQuestion({ status: "needs_review" });
    await expect(actions.rejectQuestion(id, "   ")).rejects.toThrow(/reason/i);
    expect((await statusOf(id)).status).toBe("needs_review");
  });

  it("an illegal move is a clear error, not a status change", async () => {
    const retired = await seedQuestion({ status: "retired" });
    await expect(actions.approveQuestion(retired)).rejects.toThrow(/retired, so it can't be approved/);
    const draft = await seedQuestion({ status: "draft" });
    await expect(actions.approveQuestion(draft)).rejects.toBeInstanceOf(BankError);
    expect((await statusOf(retired)).status).toBe("retired");
    await expect(actions.approveQuestion("not-a-uuid")).rejects.toThrow(/not found/i);
  });
});

describe("editQuestion versioning", () => {
  it("changing the correct option makes version 2 and keeps version 1 with its original key", async () => {
    const id = await seedQuestion({ status: "active" });
    const result = await actions.editQuestion(id, { ...MCQ_EDIT, correctOptionId: "b", explanation: "Now b." });
    expect(result).toEqual({ version: 2 });
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 2 });

    const v1 = await version(id, 1);
    expect(v1!.answer_keys).toMatchObject({ correct_option_id: "a", explanation: "The slide gives 500/TDD." });
    const v2 = await version(id, 2);
    expect(v2!.stem).toBe(MCQ_EDIT.stem);
    expect(v2!.answer_keys).toMatchObject({ correct_option_id: "b", explanation: "Now b." });
    // Options carry over when the edit does not send them.
    expect(v2!.options).toEqual(v1!.options);
    const { data: q } = await service.from("questions").select("difficulty").eq("id", id).single();
    expect(q!.difficulty).toBe("medium");
  });

  it("an edit of a needs_review question makes it active", async () => {
    const id = await seedQuestion({ status: "needs_review", reviewNotes: ["Verifier: the answer is unclear"] });
    await actions.editQuestion(id, MCQ_EDIT);
    expect((await statusOf(id)).status).toBe("active");
  });

  it("rejects an SAQ rubric whose weights add up to 4.0 and writes nothing", async () => {
    const id = await seedQuestion({ type: "saq", status: "active" });
    const rubric = {
      criteria: [
        { id: "c1", statement: "Names 500", weight: 2, equivalents: [], partial_credit_examples: [] },
        { id: "c2", statement: "Divides by TDD", weight: 1, equivalents: [], partial_credit_examples: [] },
        { id: "c3", statement: "Gives the unit", weight: 1, equivalents: [], partial_credit_examples: [] },
      ],
      critical_errors: [],
    };
    await expect(actions.editQuestion(id, { ...MCQ_EDIT, rubric })).rejects.toThrow(
      "Rubric weights must add up to 5.0",
    );
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 1 });
    expect(await version(id, 2)).toBeNull();
  });

  it("rejects an MCQ with a correct option that is not an option, and a blank stem", async () => {
    const id = await seedQuestion({ status: "active" });
    await expect(
      actions.editQuestion(id, { ...MCQ_EDIT, options: [{ id: "a", text: "x" }, { id: "b", text: "y" }] }),
    ).rejects.toThrow(/options a, b, c, d/);
    await expect(actions.editQuestion(id, { ...MCQ_EDIT, stem: "   " })).rejects.toThrow(/question text/i);
    expect(await version(id, 2)).toBeNull();
  });

  it("cannot edit a retired question", async () => {
    const id = await seedQuestion({ status: "retired" });
    await expect(actions.editQuestion(id, MCQ_EDIT)).rejects.toThrow(/retired/);
  });
});

describe("flagQuestion", () => {
  it("a student's flag marks the question flagged and records the flag", async () => {
    const id = await seedQuestion({ status: "active", stem: "Which drug class lowers heart failure admissions?" });
    asStudent();
    await actions.flagQuestion(id, "The answer looks wrong");
    expect((await statusOf(id)).status).toBe("flagged");
    const { data: flags } = await service.from("question_flags").select("user_id, comment").eq("question_id", id);
    expect(flags).toEqual([{ user_id: student.id, comment: "The answer looks wrong" }]);

    const active = await listQuestions({ status: "active" });
    expect(active.map((q) => q.id)).not.toContain(id);
    const flagged = await listQuestions({ status: "flagged" });
    expect(flagged.map((q) => q.id)).toContain(id);
  });

  it("a second flag adds a row and leaves the status; a null comment is allowed", async () => {
    const id = await seedQuestion({ status: "active" });
    asStudent();
    await actions.flagQuestion(id, null);
    await actions.flagQuestion(id, "Also unclear");
    expect((await statusOf(id)).status).toBe("flagged");
    const { data: flags } = await service.from("question_flags").select("comment").eq("question_id", id);
    expect(flags).toHaveLength(2);
  });

  it("a student cannot flag a question they cannot see", async () => {
    const id = await seedQuestion({ status: "needs_review" });
    asStudent();
    await expect(actions.flagQuestion(id, "x")).rejects.toThrow(/not found/i);
    const { data: flags } = await service.from("question_flags").select("id").eq("question_id", id);
    expect(flags).toEqual([]);
  });

  it("an admin can flag an active question", async () => {
    const id = await seedQuestion({ status: "active" });
    await actions.flagQuestion(id, "Check this");
    expect((await statusOf(id)).status).toBe("flagged");
  });

  it("approving a flagged question resolves its flags", async () => {
    const id = await seedQuestion({ status: "active" });
    asStudent();
    await actions.flagQuestion(id, "Unclear");
    asAdmin();
    expect((await getQuestionDetail(id)).flags).toEqual([{ comment: "Unclear", createdAt: expect.any(String) }]);
    await actions.approveQuestion(id);
    expect((await statusOf(id)).status).toBe("active");
    expect((await getQuestionDetail(id)).flags).toEqual([]);
  });
});

describe("answer keys and review notes stay off the student path", () => {
  it("getQuestionDetail gives a student no key and no review notes, and a raw key read returns nothing", async () => {
    const id = await seedQuestion({
      status: "active",
      reviewNotes: ["Verifier: the correct answer is a"],
      conflictNote: "Slide 3 says 450/TDD",
    });
    asStudent();
    const detail = await getQuestionDetail(id);
    expect(detail).toMatchObject({
      id,
      type: "mcq",
      status: "active",
      version: 1,
      versionCount: 1,
      topicName: f.topicName,
      reviewNotes: [],
      conflictNote: null,
      key: null,
    });
    expect(detail.options).toHaveLength(4);
    expect(detail.sourceRefs).toEqual([
      { documentId: f.documentId, pageNo: 14, slideId: f.slideId, label: "Slide 42 · page 14" },
    ]);
    const raw = await studentClient.from("answer_keys").select();
    expect(raw.data ?? []).toEqual([]);
  });

  it("a student cannot read review_notes from question_versions", async () => {
    const id = await seedQuestion({ status: "active", reviewNotes: ["Verifier: the answer is a"] });
    const denied = await studentClient.from("question_versions").select("review_notes").eq("question_id", id);
    expect(denied.error).not.toBeNull();
    expect(denied.data).toBeNull();
    const star = await studentClient.from("question_versions").select("*").eq("question_id", id);
    expect(star.error).not.toBeNull();
    const viaQuestions = await studentClient.from("questions").select("id, question_versions(review_notes)");
    expect(viaQuestions.error).not.toBeNull();
  });

  it("a student can still read the visible version through explicit columns", async () => {
    const id = await seedQuestion({ status: "active" });
    const hidden = await seedQuestion({ status: "needs_review" });
    const { data, error } = await studentClient
      .from("question_versions")
      .select("question_id, version, stem, options, source_refs, basis_quote, conflict_note, created_at");
    expect(error).toBeNull();
    expect(data!.map((v) => v.question_id)).toEqual([id]);
    expect(data!.map((v) => v.question_id)).not.toContain(hidden);
  });

  it("an anonymous client reads nothing from question_versions", async () => {
    const { anonClient } = await import("./helpers");
    await seedQuestion({ status: "active" });
    const { data, error } = await anonClient().from("question_versions").select("stem");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("an admin's detail has the key, the review notes, the conflict note and the version count", async () => {
    const id = await seedQuestion({
      status: "needs_review",
      reviewNotes: ["Verifier: the correct answer is a"],
      conflictNote: "Slide 3 says 450/TDD",
    });
    await actions.editQuestion(id, MCQ_EDIT);
    const detail = await getQuestionDetail(id);
    expect(detail).toMatchObject({
      version: 2,
      versionCount: 2,
      status: "active",
      difficulty: "medium",
      conflictNote: "Slide 3 says 450/TDD",
      key: { correctOptionId: "a", explanation: "The slide gives 500/TDD.", modelAnswer: null, keyConcepts: null, rubric: null },
    });

    // Review notes belong to the version: a fresh version starts with none; v1's are kept in the table.
    expect(detail.reviewNotes).toEqual([]);
    expect((await version(id, 1))!.review_notes).toEqual(["Verifier: the correct answer is a"]);
  });

  it("an admin sees the review notes and an SAQ's key concepts and rubric", async () => {
    const id = await seedQuestion({ type: "saq", status: "needs_review", reviewNotes: ["Verifier: weights look off"] });
    const detail = await getQuestionDetail(id);
    expect(detail.reviewNotes).toEqual(["Verifier: weights look off"]);
    expect(detail.options).toBeNull();
    expect(detail.key).toMatchObject({
      correctOptionId: null,
      modelAnswer: "The C:I ratio is 500 divided by the total daily dose.",
      keyConcepts: [{ concept: "500/TDD", equivalents: ["500 over TDD"] }],
    });
    expect(detail.key!.rubric!.criteria).toHaveLength(3);
  });

  it("a student cannot open a question that is not active or flagged", async () => {
    const id = await seedQuestion({ status: "needs_review" });
    asStudent();
    await expect(getQuestionDetail(id)).rejects.toThrow(/not found/i);
  });
});

describe("listQuestions", () => {
  it("shows a student only active and flagged questions, and an admin all but with filters", async () => {
    for (const status of ["draft", "needs_review", "active", "flagged", "retired"] as const) {
      await seedQuestion({ status });
    }
    asStudent();
    expect((await listQuestions({})).map((q) => q.status).sort()).toEqual(["active", "flagged"]);
    expect(await listQuestions({ status: "needs_review" })).toEqual([]);
    asAdmin();
    expect(await listQuestions({})).toHaveLength(5);
    expect((await listQuestions({ status: "retired" })).map((q) => q.status)).toEqual(["retired"]);
  });

  it("filters by type, topic, difficulty and handout; items carry the page-context source label", async () => {
    const other = await makeFixture("Second handout");
    const a = await seedQuestion({ status: "active", type: "mcq", difficulty: "easy" });
    const b = await seedQuestion({ status: "active", type: "saq", difficulty: "hard", conflictNote: "Slides differ" });
    const c = await seedQuestion({ status: "active", type: "mcq", difficulty: "medium", fixture: other });
    asStudent();
    const ids = async (filter: Parameters<typeof listQuestions>[0]) => (await listQuestions(filter)).map((q) => q.id).sort();
    expect(await ids({ type: "saq" })).toEqual([b]);
    expect(await ids({ difficulty: "easy" })).toEqual([a]);
    expect(await ids({ topicId: other.topicId })).toEqual([c]);
    expect(await ids({ documentId: other.documentId })).toEqual([c]);
    expect(await ids({ documentId: f.documentId })).toEqual([a, b].sort());

    const items = await listQuestions({ type: "saq" });
    expect(items[0]).toEqual({
      id: b,
      type: "saq",
      status: "active",
      difficulty: "hard",
      topicName: f.topicName,
      stem: expect.any(String),
      sourceLabel: "Slide 42 · page 14",
      hasConflictNote: true,
    });
    expect((await listQuestions({ type: "mcq", documentId: f.documentId }))[0].hasConflictNote).toBe(false);
  });

  it("lists the current version's stem after an edit", async () => {
    const id = await seedQuestion({ status: "active" });
    await actions.editQuestion(id, MCQ_EDIT);
    const [item] = await listQuestions({ status: "active" });
    expect(item).toMatchObject({ id, stem: MCQ_EDIT.stem, difficulty: "medium" });
  });
});

describe("regenerateQuestion", () => {
  it("(fake AI) writes version 2 from the cited slide, checks it and ends active", async () => {
    const id = await seedQuestion({ status: "needs_review", stem: "Old stem about the C:I ratio?" });
    const result = await actions.regenerateQuestion(id);
    expect(result).toEqual({ status: "active" });
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 2 });
    const v1 = await version(id, 1);
    const v2 = await version(id, 2);
    expect(v1!.stem).toBe("Old stem about the C:I ratio?");
    expect(v2!.stem).not.toBe(v1!.stem);
    expect(v2!.answer_keys).toMatchObject({ correct_option_id: "a" });
    expect(v1!.answer_keys).toMatchObject({ correct_option_id: "a", explanation: "The slide gives 500/TDD." });
  });

  it("asks for at most one question of the same type, from the cited slides, avoiding the current stem", async () => {
    const mcq = await seedQuestion({ status: "active", stem: "Current MCQ stem about the ratio?" });
    const saq = await seedQuestion({ type: "saq", status: "active", stem: "Current SAQ stem about the ratio." });
    const calls: AiCallInput<unknown>[] = [];
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      generate: (input) => {
        calls.push(input);
        return DEFAULT_FAKE_RESPONDERS.generate!(input);
      },
    });
    expect(await regenerateRecord(db, ai, mcq)).toEqual({ status: "active" });
    expect(await regenerateRecord(db, ai, saq)).toEqual({ status: "active" });
    const text = (call: AiCallInput<unknown>) => (call.content[0] as { text: string }).text;
    expect(text(calls[0])).toContain("at most 1 MCQ and at most 0 SAQs");
    expect(text(calls[0])).toContain("- Current MCQ stem about the ratio?");
    expect(text(calls[0])).toContain("C:I ratio = 500/TDD");
    expect(text(calls[0])).toContain("Slide 42");
    expect(text(calls[1])).toContain("at most 0 MCQs and at most 1 SAQ");
    expect(text(calls[1])).toContain("- Current SAQ stem about the ratio.");
    expect(await statusOf(saq)).toEqual({ status: "active", current_version: 2 });
    const v2 = await version(saq, 2);
    expect(v2!.answer_keys!.rubric).not.toBeNull();
  });

  it("a question the verifier fails ends in needs_review with its notes", async () => {
    const id = await seedQuestion({ status: "active" });
    const failing: FakeResponders = {
      ...DEFAULT_FAKE_RESPONDERS,
      generate: (input) => {
        const out = DEFAULT_FAKE_RESPONDERS.generate!(input) as { mcqs: { stem: string }[] };
        out.mcqs[0].stem = `FAIL ${out.mcqs[0].stem}`;
        return out;
      },
    };
    expect(await regenerateRecord(db, createFakeAiClient(failing), id)).toEqual({ status: "needs_review" });
    expect((await version(id, 2))!.review_notes.join(" ")).toContain("fake verifier");
  });

  it("a replacement that fails the pre-checks goes to needs_review without a verifier call", async () => {
    const id = await seedQuestion({ status: "active" });
    const verifyCalls: unknown[] = [];
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      generate: (input) => {
        const out = DEFAULT_FAKE_RESPONDERS.generate!(input) as { mcqs: { basis_quote: string }[] };
        out.mcqs[0].basis_quote = "A sentence that is not on the slide";
        return out;
      },
      verify: (input) => {
        verifyCalls.push(input);
        return DEFAULT_FAKE_RESPONDERS.verify!(input);
      },
    });
    expect(await regenerateRecord(db, ai, id)).toEqual({ status: "needs_review" });
    expect(verifyCalls).toHaveLength(0);
    expect((await version(id, 2))!.review_notes.join(" ")).toContain("Basis quote not found");
  });

  it("if the check itself fails, the new version waits in needs_review instead of staying a draft", async () => {
    const id = await seedQuestion({ status: "active" });
    const ai = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      verify: () => {
        throw new Error("The AI service is busy");
      },
    });
    expect(await regenerateRecord(db, ai, id)).toEqual({ status: "needs_review" });
    expect((await version(id, 2))!.review_notes.join(" ")).toMatch(/did not finish.*busy/i);
  });

  it("writes nothing when the model returns no replacement or the slides are gone", async () => {
    const id = await seedQuestion({ status: "active" });
    const none = createFakeAiClient({
      ...DEFAULT_FAKE_RESPONDERS,
      generate: () => ({ mcqs: [], saqs: [], skipped_slides: [] }),
    });
    await expect(regenerateRecord(db, none, id)).rejects.toThrow(/could not write a replacement/i);
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 1 });

    await service.from("source_slides").delete().eq("id", f.slideId);
    await expect(regenerateRecord(db, createFakeAiClient(DEFAULT_FAKE_RESPONDERS), id)).rejects.toThrow(
      /no longer available/i,
    );
    expect(await statusOf(id)).toEqual({ status: "active", current_version: 1 });
  });

  it("refuses a retired question", async () => {
    const id = await seedQuestion({ status: "retired" });
    await expect(actions.regenerateQuestion(id)).rejects.toThrow(/retired/);
  });
});

describe("create_question_version", () => {
  const rpc = (id: string, status: Status) =>
    db.rpc("create_question_version", {
      p_question_id: id,
      p_version: { stem: "S", options: null, source_refs: [], basis_quote: "q", conflict_note: null, review_notes: [] },
      p_key: { correct_option_id: null, explanation: null, model_answer: "m", key_concepts: null, rubric: null },
      p_status: status,
    });

  it("is not callable by signed-in users", async () => {
    const id = await seedQuestion({ status: "active" });
    const { error } = await studentClient.rpc("create_question_version", {
      p_question_id: id,
      p_version: {},
      p_key: {},
      p_status: "active",
    });
    expect(error).not.toBeNull();
  });

  it("numbers versions after the highest, and refuses draft and retired questions", async () => {
    const id = await seedQuestion({ status: "active" });
    expect((await rpc(id, "active")).data).toBe(2);
    expect((await rpc(id, "draft")).data).toBe(3);
    // Now a draft: no further version until it is checked.
    expect((await rpc(id, "active")).error).not.toBeNull();
    expect((await statusOf(id)).current_version).toBe(3);
    const retired = await seedQuestion({ status: "retired" });
    expect((await rpc(retired, "active")).error).not.toBeNull();
    expect((await rpc(id, "flagged")).error).not.toBeNull();
  });

  it("is atomic: a version that cannot be written leaves nothing behind", async () => {
    const id = await seedQuestion({ status: "active" });
    const bad = await db.rpc("create_question_version", {
      p_question_id: id,
      p_version: { stem: "S", source_refs: [], basis_quote: "q", difficulty: "impossible" },
      p_key: {},
      p_status: "active",
    });
    expect(bad.error).not.toBeNull();
    expect((await statusOf(id)).current_version).toBe(1);
    expect(await version(id, 2)).toBeNull();
  });
});
