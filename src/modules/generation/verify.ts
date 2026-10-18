import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeForMatch } from "@/lib/text";
import type { AiClient } from "@/modules/ai/client";
import { DEDUP_PROMPT } from "@/modules/ai/prompts/dedup";
import { VERIFY_QUESTION_PROMPT } from "@/modules/ai/prompts/verifyQuestion";
import { RubricSchema, type Rubric } from "@/modules/ai/schemas/generation";
import { DedupSchema, VerificationSchema } from "@/modules/ai/schemas/verification";
import { transition, type LifecycleAction, type QuestionStatus } from "@/modules/bank/lifecycle";
import { slideLabel } from "@/modules/ingestion/slideLabel";
import {
  loadPagePhotos,
  pagePhotoBlocks,
  slideBlock,
  type SlideForGeneration,
  type SlideWithPage,
} from "./generate";
import { AUTO_CHECK_PREFIX } from "./validate";

type Db = SupabaseClient<Database>;

/**
 * Bank questions at least this similar (trigram) to a new stem are dedup
 * candidates (find_similar_stems' p_threshold).
 */
export const SIMILAR_STEM_THRESHOLD = 0.3;

/**
 * A candidate at least this similar, of the same type and with the same answer
 * (after normalising), is a duplicate without asking the model.
 */
export const DUPLICATE_AUTO_THRESHOLD = 0.98;

/** The most characters of an answer the dedup model is shown. */
export const ANSWER_EXCERPT_CHARS = 200;

/** Prefix of the review notes the verifier writes. */
export const VERIFIER_PREFIX = "Verifier: ";

/** Prefix of the note on a draft whose automatic check kept failing (R37). */
export const UNFINISHED_CHECK_PREFIX = "Automatic check could not finish: ";

export type QuestionWithKey = {
  id: string;
  type: "mcq" | "saq";
  stem: string;
  options: { id: string; text: string }[] | null;
  difficulty: "easy" | "medium" | "hard";
  basisQuote: string;
  sourceSlideIds: string[];
  correctOptionId: string | null;
  explanation: string | null;
  modelAnswer: string | null;
  rubric: Rubric | null;
  /** The version's conflict note, shown to the verifier so it reports only new conflicts. */
  conflictNote: string | null;
};

/** What dedup compares: the stem, the type and the answer (correct option text or model answer). */
export type DedupQuestion = { id: string; type: "mcq" | "saq"; stem: string; answer: string };

/** A find_similar_stems row. */
export type SimilarStem = {
  question_id: string;
  type: "mcq" | "saq";
  stem: string;
  answer: string;
  sim: number;
};

/** The answer dedup compares: an MCQ's correct option text, or an SAQ's model answer. */
export function answerText(q: QuestionWithKey): string {
  if (q.type === "mcq") return q.options?.find((o) => o.id === q.correctOptionId)?.text ?? "";
  return q.modelAnswer ?? "";
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function excerpt(answer: string): string {
  const text = oneLine(answer);
  return text.length > ANSWER_EXCERPT_CHARS ? `${text.slice(0, ANSWER_EXCERPT_CHARS)}…` : text || "(none)";
}

const TYPE_LABEL = { mcq: "MCQ", saq: "SAQ" } as const;

/**
 * Whether `q` tests the same fact as one of `candidates` (find_similar_stems
 * rows). No candidates: not a duplicate, no AI call. A candidate with a stem at
 * least DUPLICATE_AUTO_THRESHOLD similar, the same type and the same answer
 * (normalizeForMatch): a duplicate of it, no AI call. Otherwise one dedup call
 * that sees each question's type, stem and answer, with candidates under short
 * ids (Q1, Q2, ...); an id the model invents is not a duplicate.
 */
export async function checkDuplicate(
  q: DedupQuestion,
  candidates: SimilarStem[],
  ai: AiClient,
  documentId: string,
): Promise<{ duplicateOf: string | null; reason: string }> {
  if (candidates.length === 0) return { duplicateOf: null, reason: "" };
  const answer = normalizeForMatch(q.answer);
  const same = candidates.find(
    (c) =>
      c.sim >= DUPLICATE_AUTO_THRESHOLD &&
      c.type === q.type &&
      answer !== "" &&
      normalizeForMatch(c.answer) === answer,
  );
  if (same) {
    return {
      duplicateOf: same.question_id,
      reason: `Same type and answer, nearly identical wording (similarity ${same.sim.toFixed(2)})`,
    };
  }

  const aliases = candidates.map((_, i) => `Q${i + 1}`);
  const block = (head: string, x: { stem: string; answer: string }) =>
    `${head}\nStem: ${oneLine(x.stem)}\nAnswer: ${excerpt(x.answer)}`;
  const text = [
    block(`New question (${TYPE_LABEL[q.type]}):`, q),
    `Existing questions:\n\n${candidates.map((c, i) => block(`[${aliases[i]}] ${TYPE_LABEL[c.type]}`, c)).join("\n\n")}`,
  ].join("\n\n");
  const { data } = await ai.callStructured({
    task: "dedup",
    promptVersion: DEDUP_PROMPT.version,
    system: DEDUP_PROMPT.system,
    content: [{ type: "text", text }],
    schema: DedupSchema,
    documentId,
    // Not sent to the model; lets the fake AI answer.
    meta: { stem: q.stem, candidates: aliases.join(",") },
  });

  const reason = data.reason.trim();
  const alias = data.duplicate_of_question_id?.trim().toUpperCase() ?? "";
  if (!alias) return { duplicateOf: null, reason };
  const index = aliases.indexOf(alias);
  if (index < 0) {
    console.warn(`dedup: the model named an unknown question "${alias}"; not treated as a duplicate`);
    return { duplicateOf: null, reason };
  }
  return { duplicateOf: candidates[index].question_id, reason };
}

const marks = (weight: number) => `${weight} mark${weight === 1 ? "" : "s"}`;

/** The question and its answer key as the verifier sees them. */
function questionSection(q: QuestionWithKey): string {
  if (q.type === "mcq") {
    return [
      "Type: MCQ (single best answer)",
      `Difficulty: ${q.difficulty}`,
      `Stem: ${q.stem}`,
      `Options:\n${(q.options ?? []).map((o) => `${o.id}) ${o.text}`).join("\n")}`,
      "Answer key:",
      `Correct option: ${q.correctOptionId ?? "(none)"}`,
      `Explanation: ${q.explanation ?? "(none)"}`,
    ].join("\n");
  }
  const rubric = q.rubric;
  const criteria = (rubric?.criteria ?? []).map((c) => {
    const parts = [`- ${c.id} (${marks(c.weight)}): ${c.statement}`];
    if (c.equivalents.length) parts.push(`also accept: ${c.equivalents.join("; ")}`);
    if (c.partial_credit_examples.length) parts.push(`partial credit: ${c.partial_credit_examples.join("; ")}`);
    return parts.join(" | ");
  });
  const errors = (rubric?.critical_errors ?? []).map((e) => `- ${e.id}: ${e.statement}`);
  return [
    "Type: SAQ (short-answer question)",
    `Difficulty: ${q.difficulty}`,
    `Question: ${q.stem}`,
    "Answer key:",
    `Model answer:\n${q.modelAnswer ?? "(none)"}`,
    `Rubric (marks out of 5):\n${criteria.join("\n") || "(none)"}`,
    `Critical errors:\n${errors.join("\n") || "(none)"}`,
  ].join("\n");
}

/**
 * An independent check of one question against the slides it cites (and their
 * page photos, by the same rule as generation). The pass is decided here, never
 * by the model's `pass` alone: every check must hold as well. Notes name each
 * failed check and carry the model's issues; a guideline conflict is returned
 * for the version's conflict note and does not fail the question.
 */
export async function verifyQuestion(
  q: QuestionWithKey,
  slides: SlideForGeneration[],
  ai: AiClient,
  documentId: string,
  pageDocs: Map<string, Uint8Array> = new Map(),
): Promise<{ pass: boolean; notes: string[]; conflictNote: string | null }> {
  const aliases = slides.map((_, i) => `S${i + 1}`);
  const text = [
    questionSection(q),
    `Passage the writer says proves the answer:\n${q.basisQuote}`,
    `Conflict note already on the question:\n${q.conflictNote?.trim() || "(none)"}`,
    `Cited slides:\n\n${slides.map((slide, i) => slideBlock(slide, aliases[i])).join("\n\n")}`,
  ].join("\n\n");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text },
    ...pagePhotoBlocks(slides, aliases, pageDocs),
  ];

  const { data } = await ai.callStructured({
    task: "verify",
    promptVersion: VERIFY_QUESTION_PROMPT.version,
    system: VERIFY_QUESTION_PROMPT.system,
    content,
    schema: VerificationSchema,
    documentId,
    // Not sent to the model; lets the fake AI answer.
    meta: { stem: q.stem, type: q.type },
  });

  const checks: [boolean, string][] = [
    [data.answer_supported_by_slide, "the answer is not supported by the cited slide"],
    q.type === "mcq"
      ? [data.single_best_answer_ok === true, "the MCQ does not have exactly one defensible answer"]
      : [data.rubric_consistent === true, "the rubric does not match the model answer"],
    [!data.ambiguous, "the question is ambiguous"],
    [!data.stem_gives_away_answer, "the stem gives the answer away"],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, note]) => note);
  const pass = data.pass && failed.length === 0;
  const notes = [...failed, ...data.issues.map((issue) => issue.trim()).filter(Boolean)];
  if (!pass && notes.length === 0) notes.push("the reviewer failed the question without giving a reason");
  return {
    pass,
    notes: notes.map((note) => `${VERIFIER_PREFIX}${note}`),
    conflictNote: data.guideline_conflict?.trim() || null,
  };
}

type LoadedQuestion = { status: QuestionStatus; version: number; reviewNotes: string[]; question: QuestionWithKey };

/** The question's current version and its answer key. */
async function loadQuestion(db: Db, questionId: string): Promise<LoadedQuestion> {
  const { data, error } = await db
    .from("questions")
    .select(
      "id, type, status, difficulty, current_version, question_versions(version, stem, options, source_refs, basis_quote, conflict_note, review_notes, answer_keys(correct_option_id, explanation, model_answer, rubric))",
    )
    .eq("id", questionId)
    .single();
  if (error) throw new Error(`Could not read question ${questionId}: ${error.message}`);
  const version = data.question_versions.find((v) => v.version === data.current_version);
  const key = version?.answer_keys;
  if (!version || !key) throw new Error(`Question ${questionId} has no current version with an answer key`);
  if (data.type === "essay") throw new Error(`Question ${questionId} is an essay, which is not checked here`);

  const refs = Array.isArray(version.source_refs) ? version.source_refs : [];
  const sourceSlideIds = refs
    .map((ref) => (ref && typeof ref === "object" && !Array.isArray(ref) ? ref.slideId : null))
    .filter((id): id is string => typeof id === "string");
  return {
    status: data.status,
    version: version.version,
    reviewNotes: version.review_notes,
    question: {
      id: data.id,
      type: data.type,
      stem: version.stem,
      options: Array.isArray(version.options) ? (version.options as { id: string; text: string }[]) : null,
      difficulty: data.difficulty,
      basisQuote: version.basis_quote,
      sourceSlideIds,
      correctOptionId: key.correct_option_id,
      explanation: key.explanation,
      modelAnswer: key.model_answer,
      rubric: RubricSchema.safeParse(key.rubric).data ?? null,
      conflictNote: version.conflict_note,
    },
  };
}

/** The cited slides that still exist, in citation order, with their labels and pages. */
export async function loadCitedSlides(db: Db, slideIds: string[]): Promise<SlideWithPage[]> {
  if (slideIds.length === 0) return [];
  const { data, error } = await db
    .from("source_slides")
    .select(
      "id, page_id, position_on_page, printed_slide_no, title, verbatim_text, tables, diagram_description, source_pages!inner(page_no, storage_path)",
    )
    .in("id", slideIds);
  if (error) throw new Error(`Could not read the cited slides: ${error.message}`);
  const byId = new Map(data.map((row) => [row.id, row]));
  return [...new Set(slideIds)].flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const page = row.source_pages;
    return [
      {
        id: row.id,
        label: slideLabel({
          printed_slide_no: row.printed_slide_no,
          page_no: page.page_no,
          position_on_page: row.position_on_page,
        }),
        pageId: row.page_id,
        title: row.title,
        verbatim_text: row.verbatim_text,
        tables: Array.isArray(row.tables) ? row.tables : [],
        diagram_description: row.diagram_description,
        pageNo: page.page_no,
        storagePath: page.storage_path,
      },
    ];
  });
}

/**
 * Moves a draft on by `action` (through the lifecycle table), appending notes and
 * a conflict note to its current version in one transaction. Writes nothing if
 * the question has left draft meanwhile; returns the status it ends with.
 */
async function record(
  db: Db,
  loaded: LoadedQuestion,
  action: LifecycleAction,
  notes: string[],
  conflictNote: string | null,
): Promise<QuestionStatus> {
  const { to } = transition("draft", action, "system");
  const { data: written, error } = await db.rpc("record_question_check", {
    p_question_id: loaded.question.id,
    p_version: loaded.version,
    p_status: to,
    p_notes: notes,
    p_conflict_note: conflictNote ?? "",
  });
  if (error) throw new Error(`Could not save the check of question ${loaded.question.id}: ${error.message}`);
  if (written) return to;
  return (await loadQuestion(db, loaded.question.id)).status;
}

/** find_similar_stems rows as candidates; essays are never compared with MCQs or SAQs. */
export function toSimilarStems(
  rows: { question_id: string; type: string; stem: string; answer: string; sim: number }[],
): SimilarStem[] {
  return rows.flatMap((row) =>
    row.type === "mcq" || row.type === "saq" ? [{ ...row, type: row.type }] : [],
  );
}

/**
 * Checks one draft question and moves it out of draft:
 *   1. a pre-check ("Auto-check: ") note → verify_fail, no AI call;
 *   2. a duplicate of a bank question → mark_duplicate, noted "Duplicate of <id>: <reason>";
 *   3. otherwise the independent verifier → verify_pass or verify_fail with its notes,
 *      and any guideline conflict appended to the version's conflict note.
 * A question that is no longer a draft is left alone (safe to re-run).
 */
export async function processDraftQuestion(
  questionId: string,
  deps: { db: Db; ai: AiClient; documentId: string },
): Promise<QuestionStatus> {
  const { db, ai, documentId } = deps;
  const loaded = await loadQuestion(db, questionId);
  if (loaded.status !== "draft") return loaded.status;
  const { question } = loaded;

  if (loaded.reviewNotes.some((note) => note.startsWith(AUTO_CHECK_PREFIX))) {
    return record(db, loaded, "verify_fail", [], null);
  }

  const { data: rows, error } = await db.rpc("find_similar_stems", {
    p_stem: question.stem,
    p_exclude_question: question.id,
    p_threshold: SIMILAR_STEM_THRESHOLD,
  });
  if (error) throw new Error(`Could not look for similar questions: ${error.message}`);
  const duplicate = await checkDuplicate(
    { id: question.id, type: question.type, stem: question.stem, answer: answerText(question) },
    toSimilarStems(rows),
    ai,
    documentId,
  );
  if (duplicate.duplicateOf) {
    return record(db, loaded, "mark_duplicate", [`Duplicate of ${duplicate.duplicateOf}: ${duplicate.reason}`], null);
  }

  const slides = await loadCitedSlides(db, question.sourceSlideIds);
  if (slides.length === 0) {
    return record(db, loaded, "verify_fail", [`${VERIFIER_PREFIX}the cited slide could not be found`], null);
  }
  const pageDocs = await loadPagePhotos(db, slides);
  const result = await verifyQuestion(question, slides, ai, documentId, pageDocs);
  return record(db, loaded, result.pass ? "verify_pass" : "verify_fail", result.notes, result.conflictNote);
}

/**
 * Sends a draft whose automatic check could not finish (the AI kept failing on it)
 * to the review queue with the note "Automatic check could not finish: <reason>".
 * A question that is no longer a draft is left alone.
 */
export async function markCheckUnfinished(
  db: Db,
  questionId: string,
  reason: string,
): Promise<QuestionStatus> {
  const loaded = await loadQuestion(db, questionId);
  if (loaded.status !== "draft") return loaded.status;
  return record(db, loaded, "verify_fail", [`${UNFINISHED_CHECK_PREFIX}${reason}`], null);
}
