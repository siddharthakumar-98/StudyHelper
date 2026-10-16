import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/** Waits until the login form is hydrated, so fill/click are never lost to a cold compile. */
export async function openLogin(page: Page) {
  await page.goto("/login");
  await page.locator('form[data-hydrated="true"]').waitFor();
}

export async function loginAs(page: Page, who: "student" | "admin" = "student") {
  const prefix = who.toUpperCase();
  await openLogin(page);
  await page.getByLabel("Email").fill(process.env[`${prefix}_EMAIL`]!);
  await page.getByLabel("Password").fill(process.env[`${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

// ---------------------------------------------------------------- question bank seeding

function serviceDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Empties every app table except profiles, so a spec that counts rows starts from nothing. */
export async function resetDb(): Promise<void> {
  const { error } = await serviceDb().rpc("test_reset_app_tables");
  if (error) throw new Error(`resetDb failed: ${error.message}`);
}

export const REVIEW_NOTE = "Verifier: Answer not supported by cited slide";
/** The explanation of every seeded multiple-choice question: must never reach a student's page. */
export const SEEDED_EXPLANATION = "Because the slide gives the carbohydrate rule as five hundred over TDD.";
export const SEEDED_CORRECT_TEXT = "500/TDD";
export const SEEDED_MODEL_ANSWER = "Divide five hundred by the total daily dose of insulin.";

export type SeededQuestion = { id: string; type: "mcq" | "saq"; stem: string };

type Item = Record<string, unknown>;

function seedItem(n: number, type: "mcq" | "saq", slideId: string, documentId: string, notes: string[]): Item {
  return {
    type,
    difficulty: ["easy", "medium", "hard"][n % 3],
    stem: `Seeded ${type === "mcq" ? "multiple choice" : "short answer"} question number ${n} about insulin dosing`,
    options:
      type === "mcq"
        ? [
            { id: "a", text: SEEDED_CORRECT_TEXT },
            { id: "b", text: "1650/TDD" },
            { id: "c", text: "1800/TDD" },
            { id: "d", text: "300/TDD" },
          ]
        : null,
    source_refs: [{ documentId, pageNo: 14, slideId, label: "Slide 42" }],
    basis_quote: "C:I ratio = 500/TDD",
    conflict_note: null,
    review_notes: notes,
    correct_option_id: type === "mcq" ? "a" : null,
    explanation: type === "mcq" ? SEEDED_EXPLANATION : null,
    model_answer: type === "saq" ? SEEDED_MODEL_ANSWER : null,
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
}

/**
 * Wipes the database, then inserts one handout (slide 42 on page 14), one topic and the
 * requested questions with their versions and answer keys, through the service client
 * (students cannot read key-adjacent columns directly). The first two active questions
 * are multiple choice, the third short answer; the needs-review ones carry REVIEW_NOTE.
 */
export async function seedQuestions(counts: { active: number; needsReview: number }) {
  await resetDb();
  const db = serviceDb();
  const must = <T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (r.error || r.data === null) throw new Error(`seedQuestions: ${what}: ${r.error?.message}`);
    return r.data as NonNullable<T>;
  };

  const doc = must(
    await db.from("documents").insert({ title: "Seeded bank handout", status: "ready" }).select("id").single(),
    "document",
  );
  const pageRow = must(
    await db
      .from("source_pages")
      .insert({
        document_id: doc.id,
        page_no: 14,
        source_file_index: 0,
        kind: "pdf_page",
        storage_path: `${doc.id}/14.pdf`,
      })
      .select("id")
      .single(),
    "page",
  );
  const slide = must(
    await db
      .from("source_slides")
      .insert({
        page_id: pageRow.id,
        position_on_page: 1,
        printed_slide_no: "42",
        title: "Insulin dosing",
        verbatim_text: "C:I ratio = 500/TDD",
        legibility: "clear",
      })
      .select("id")
      .single(),
    "slide",
  );
  const topic = must(await db.from("topics").insert({ name: "Insulin dosing" }).select("id").single(), "topic");
  const run = must(
    await db.from("generation_runs").insert({ document_id: doc.id }).select("id").single(),
    "run",
  );

  async function insertOne(n: number, type: "mcq" | "saq", status: "active" | "needs_review") {
    const batchKey = `e2e-seed-${n}`;
    const item = seedItem(n, type, slide.id, doc.id, status === "needs_review" ? [REVIEW_NOTE] : []);
    const saved = await db.rpc("save_generated_questions", {
      p_run_id: run.id,
      p_topic_id: topic.id,
      p_batch_key: batchKey,
      p_items: [item],
    });
    if (saved.error) throw new Error(`seedQuestions: save: ${saved.error.message}`);
    const q = must(await db.from("questions").select("id").eq("batch_key", batchKey).single(), "question");
    const upd = await db.from("questions").update({ status }).eq("id", q.id);
    if (upd.error) throw new Error(`seedQuestions: status: ${upd.error.message}`);
    return { id: q.id as string, type, stem: item.stem as string } satisfies SeededQuestion;
  }

  const active: SeededQuestion[] = [];
  const needsReview: SeededQuestion[] = [];
  let n = 0;
  for (let i = 0; i < counts.active; i++) {
    active.push(await insertOne(++n, i < 2 ? "mcq" : i === 2 ? "saq" : "mcq", "active"));
  }
  for (let i = 0; i < counts.needsReview; i++) {
    needsReview.push(await insertOne(++n, "mcq", "needs_review"));
  }
  return { active, needsReview, documentId: doc.id as string };
}

/** Waits until every hydration marker on the page has flipped (webkit paints before it hydrates). */
export async function waitHydrated(page: Page) {
  await page.waitForFunction(
    () =>
      document.querySelector("[data-hydrated]") !== null &&
      document.querySelector('[data-hydrated="false"]') === null,
  );
}

/** Saves version 2 of a seeded multiple-choice question behind the page's back (the admin's page still holds version 1). */
export async function bumpQuestionVersion(id: string): Promise<void> {
  const db = serviceDb();
  const { data: v1, error } = await db
    .from("question_versions")
    .select("options, source_refs")
    .eq("question_id", id)
    .eq("version", 1)
    .single();
  if (error || !v1) throw new Error(`bumpQuestionVersion: ${error?.message}`);
  const { error: rpcError } = await db.rpc("create_question_version", {
    p_question_id: id,
    p_version: {
      stem: "Changed by someone else in another tab",
      options: v1.options,
      source_refs: v1.source_refs,
      basis_quote: "C:I ratio = 500/TDD",
      conflict_note: null,
      review_notes: [],
      difficulty: "easy",
    },
    p_key: {
      correct_option_id: "a",
      explanation: SEEDED_EXPLANATION,
      model_answer: null,
      key_concepts: null,
      rubric: null,
    },
    p_status: "active",
    p_expected_version: 1,
  });
  if (rpcError) throw new Error(`bumpQuestionVersion: ${rpcError.message}`);
}
