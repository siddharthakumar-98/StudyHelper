import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { BankError } from "@/modules/bank/errors";
import { startQuestionWritingRecord, updateSlideTextRecord } from "@/modules/ingestion/slideService";
import { createTestUser, resetDb, serviceClient } from "./helpers";

// R38: the pipeline pauses after extraction so the admin can check the slides;
// "Write questions" starts topic_map; a later slide correction reaches the
// questions that cite the slide.

const db = serviceClient() as SupabaseClient<Database>;

type Status = Database["public"]["Enums"]["question_status"];

async function documentIn(status: string) {
  const admin = await createTestUser("admin");
  const { data, error } = await db
    .from("documents")
    .insert({ title: "Review pause fixture", uploaded_by: admin.id, status })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function topicMapJobs(documentId: string) {
  const { data, error } = await db
    .from("jobs")
    .select("id, status")
    .eq("document_id", documentId)
    .eq("kind", "topic_map");
  expect(error).toBeNull();
  return data!;
}

async function docStatus(documentId: string) {
  const { data } = await db.from("documents").select("status").eq("id", documentId).single();
  return data!.status;
}

describe("startQuestionWritingRecord", () => {
  beforeEach(resetDb);

  it("starts topic_map once and moves the handout on to processing", async () => {
    const documentId = await documentIn("review");
    const { jobId } = await startQuestionWritingRecord(db, documentId);
    expect(await topicMapJobs(documentId)).toEqual([{ id: jobId, status: "pending" }]);
    expect(await docStatus(documentId)).toBe("processing");
  });

  it("is idempotent: a second click (or a second tab) gets the same unfinished job", async () => {
    const documentId = await documentIn("review");
    const results = await Promise.all([
      startQuestionWritingRecord(db, documentId),
      startQuestionWritingRecord(db, documentId),
      startQuestionWritingRecord(db, documentId),
    ]);
    const jobs = await topicMapJobs(documentId);
    expect(jobs).toHaveLength(1);
    expect(results.map((r) => r.jobId)).toEqual([jobs[0].id, jobs[0].id, jobs[0].id]);
  });

  it("refuses a handout that is not waiting for its slide check, creating nothing", async () => {
    for (const status of ["processing", "ready", "uploading"]) {
      const documentId = await documentIn(status);
      await expect(startQuestionWritingRecord(db, documentId)).rejects.toThrow(BankError);
      expect(await topicMapJobs(documentId)).toEqual([]);
      expect(await docStatus(documentId)).toBe(status);
    }
  });

  it("refuses an unknown or malformed handout id", async () => {
    await expect(
      startQuestionWritingRecord(db, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(BankError);
    await expect(startQuestionWritingRecord(db, "not-a-uuid")).rejects.toThrow(BankError);
  });
});

describe("updateSlideTextRecord sends questions citing the slide to review", () => {
  beforeEach(resetDb);

  async function fixture() {
    const documentId = await documentIn("ready");
    const { data: page } = await db
      .from("source_pages")
      .insert({ document_id: documentId, page_no: 1, source_file_index: 0, kind: "pdf_page", storage_path: `${documentId}/1.pdf` })
      .select("id")
      .single();
    const { data: slides } = await db
      .from("source_slides")
      .insert([
        { page_id: page!.id, position_on_page: 1, printed_slide_no: "41", verbatim_text: "C:I = 500/TDD", legibility: "clear" },
        { page_id: page!.id, position_on_page: 2, printed_slide_no: "42", verbatim_text: "CF = 1650/TDD", legibility: "clear" },
      ])
      .select("id, position_on_page");
    const [corrected, other] = [...slides!].sort((a, b) => a.position_on_page - b.position_on_page).map((s) => s.id as string);
    const { data: topic } = await db.from("topics").insert({ name: "Insulin dosing" }).select("id").single();
    const { data: run } = await db.from("generation_runs").insert({ document_id: documentId }).select("id").single();

    /** Saves one MCQ citing `slideId` and puts it in `status`. */
    async function question(name: string, slideId: string, status: Status) {
      const item: Record<string, Json> = {
        type: "mcq",
        difficulty: "easy",
        stem: `Question ${name}`,
        options: [
          { id: "a", text: "500/TDD" },
          { id: "b", text: "1650/TDD" },
        ],
        source_refs: [{ documentId, pageNo: 1, slideId, label: "Slide" }],
        basis_quote: "500/TDD",
        conflict_note: null,
        review_notes: [],
        correct_option_id: "a",
        explanation: "The slide says so.",
        model_answer: null,
        key_concepts: null,
        rubric: null,
      };
      const { error } = await db.rpc("save_generated_questions", {
        p_run_id: run!.id,
        p_topic_id: topic!.id,
        p_batch_key: name,
        p_items: [item],
      });
      expect(error).toBeNull();
      const { data: q } = await db.from("questions").select("id").eq("batch_key", name).single();
      await db.from("questions").update({ status }).eq("id", q!.id);
      return q!.id as string;
    }
    return { corrected, other, question };
  }

  async function state(id: string) {
    const { data } = await db
      .from("questions")
      .select("status, current_version, question_versions(version, review_notes)")
      .eq("id", id)
      .single();
    const notes = data!.question_versions.find((v) => v.version === data!.current_version)!.review_notes;
    return { status: data!.status, notes };
  }

  it("moves active questions to needs_review with a note, notes the ones already waiting, leaves drafts and retired alone", async () => {
    const f = await fixture();
    const active = await f.question("active", f.corrected, "active");
    const waiting = await f.question("waiting", f.corrected, "needs_review");
    const flagged = await f.question("flagged", f.corrected, "flagged");
    const draft = await f.question("draft", f.corrected, "draft");
    const retired = await f.question("retired", f.corrected, "retired");
    const elsewhere = await f.question("elsewhere", f.other, "active");

    const result = await updateSlideTextRecord(db, f.corrected, "C:I ratio = 500/TDD (corrected)");
    expect(result).toEqual({ questionsSentToReview: 3 });

    const note = ["Source slide was corrected"];
    expect(await state(active)).toEqual({ status: "needs_review", notes: note });
    expect(await state(waiting)).toEqual({ status: "needs_review", notes: note });
    // Already in the admin's queue: it stays flagged, so the student's flag is not silently resolved.
    expect(await state(flagged)).toEqual({ status: "flagged", notes: note });
    expect(await state(draft)).toEqual({ status: "draft", notes: [] });
    expect(await state(retired)).toEqual({ status: "retired", notes: [] });
    expect(await state(elsewhere)).toEqual({ status: "active", notes: [] });
  });

  it("only looks at each question's current version", async () => {
    const f = await fixture();
    const id = await f.question("moved", f.corrected, "active");
    // Version 2 cites the other slide only.
    const { error } = await db.rpc("create_question_version", {
      p_question_id: id,
      p_version: {
        stem: "Question moved v2",
        options: [
          { id: "a", text: "1650/TDD" },
          { id: "b", text: "500/TDD" },
        ],
        source_refs: [{ documentId: "x", pageNo: 1, slideId: f.other, label: "Slide 42" }],
        basis_quote: "1650/TDD",
        conflict_note: null,
        review_notes: [],
      },
      p_key: { correct_option_id: "a", explanation: "e", model_answer: null, key_concepts: null, rubric: null },
      p_status: "active",
      p_expected_version: 1,
    });
    expect(error).toBeNull();
    expect(await updateSlideTextRecord(db, f.corrected, "corrected")).toEqual({ questionsSentToReview: 0 });
    expect((await state(id)).status).toBe("active");
  });
});
