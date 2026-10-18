import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AiClient } from "@/modules/ai/client";
import {
  GeneratedMcqSchema,
  GeneratedSaqSchema,
  RubricSchema,
  type GeneratedMcq,
  type GeneratedSaq,
  type Rubric,
} from "@/modules/ai/schemas/generation";
import { generateForTopic, loadPagePhotos } from "@/modules/generation/generate";
import { AUTO_CHECK_PREFIX, validateGenerated, validateStructure } from "@/modules/generation/validate";
import { loadCitedSlides, processDraftQuestion, VERIFIER_PREFIX } from "@/modules/generation/verify";
import { slideHeading } from "@/modules/ingestion/slideLabel";
import { BankError } from "./errors";
import {
  IllegalTransitionError,
  transition,
  type Actor,
  type LifecycleAction,
  type QuestionStatus,
} from "./lifecycle";

export { BankError };

// Everything the Question Bank reads and writes, with the database passed in.
// Kept out of the "use server" file (its exports become callable from the
// browser) and free of "server-only" so integration tests can drive it. Callers
// decide who may call. Row level security (the user's own client) decides which
// questions a user sees; the service client, which only an action or loader that
// has already run requireAdmin()/requireUser() may pass in, adds the columns
// signed-in users cannot read (conflict note, review notes, answer key) and does
// every write.

type Db = SupabaseClient<Database>;
type Difficulty = "easy" | "medium" | "hard";
type Option = { id: string; text: string };
type KeyConcept = { concept: string; equivalents: string[] };

export type BankFilter = {
  status?: QuestionStatus;
  type?: "mcq" | "saq";
  topicId?: string;
  difficulty?: Difficulty;
  documentId?: string;
};

export type BankListItem = {
  id: string;
  type: "mcq" | "saq" | "essay";
  status: QuestionStatus;
  difficulty: Difficulty;
  topicName: string;
  stem: string;
  sourceLabel: string;
  hasConflictNote: boolean;
};

export type SourceRef = { documentId: string; pageNo: number; slideId: string; label: string };

export type AnswerKeyView = {
  correctOptionId: string | null;
  explanation: string | null;
  modelAnswer: string | null;
  keyConcepts: KeyConcept[] | null;
  rubric: Rubric | null;
};

export type QuestionDetail = {
  id: string;
  type: "mcq" | "saq" | "essay";
  status: QuestionStatus;
  version: number;
  versionCount: number;
  difficulty: Difficulty;
  topicName: string;
  stem: string;
  options: Option[] | null;
  sourceRefs: SourceRef[];
  conflictNote: string | null;
  /** Admins only: verifier notes can name the correct answer. */
  reviewNotes: string[];
  flags: { comment: string | null; createdAt: string }[];
  /** Admins only. */
  key: AnswerKeyView | null;
};

export type QuestionEdit = {
  stem: string;
  difficulty: Difficulty;
  options?: Option[];
  correctOptionId?: string;
  explanation?: string;
  modelAnswer?: string;
  keyConcepts?: KeyConcept[];
  rubric?: Rubric;
};

const NOT_FOUND = "Question not found";
const CHANGED = "This question was changed by someone else. Reload and try again.";
const MAX_COMMENT_CHARS = 1000;
const MAX_REASON_CHARS = 1000;
const STALE =
  "This question was changed since you opened it. Reload the page to see the latest version, then try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ----------------------------------------------------------------- labels

/**
 * The label shown for a stored source reference, with page context ("Slide 42 ·
 * page 14"): rebuilt from the stored label (slideLabel's two forms) and page so
 * slideHeading, the one place that formats it, stays the single source.
 */
export function refHeading(ref: { label: string; pageNo: number }): string {
  const printed = /^Slide (.+)$/.exec(ref.label)?.[1] ?? null;
  const photo = /^Page \d+, photo (\d+)$/.exec(ref.label)?.[1];
  if (printed === null && photo === undefined) return ref.label;
  return slideHeading({
    printed_slide_no: printed,
    page_no: ref.pageNo,
    position_on_page: photo === undefined ? 1 : Number(photo),
  });
}

/** One line for the list: the first source, and how many more there are. */
export function sourceLabelOf(refs: SourceRef[]): string {
  if (refs.length === 0) return "";
  const first = refHeading(refs[0]);
  return refs.length === 1 ? first : `${first} + ${refs.length - 1} more`;
}

function parseRefs(value: Json): SourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { documentId, pageNo, slideId, label } = item;
    if (typeof documentId !== "string" || typeof slideId !== "string") return [];
    return [
      {
        documentId,
        slideId,
        pageNo: typeof pageNo === "number" ? pageNo : 0,
        label: typeof label === "string" ? label : "",
      },
    ];
  });
}

const parseOptions = (value: Json): Option[] | null =>
  Array.isArray(value) ? (value as unknown as Option[]) : null;

function parseKeyConcepts(value: Json | undefined): KeyConcept[] | null {
  return GeneratedSaqSchema.shape.key_concepts.safeParse(value).data ?? null;
}

const currentOf = <V extends { version: number }>(versions: V[], current: number): V | undefined =>
  versions.find((v) => v.version === current);

// ------------------------------------------------------------------ reads

/** conflict_note is not readable by signed-in users; ids per request keep the URL short. */
const NOTE_CHUNK = 100;

/**
 * Conflict notes of the given (question, current version) pairs, read with the
 * service client. Callers pass only ids that row level security already showed
 * to the user, so this never widens what a student can reach.
 */
async function loadConflictNotes(
  service: Db,
  versions: { id: string; version: number }[],
): Promise<Map<string, string | null>> {
  const notes = new Map<string, string | null>();
  for (let i = 0; i < versions.length; i += NOTE_CHUNK) {
    const chunk = versions.slice(i, i + NOTE_CHUNK);
    const { data, error } = await service
      .from("question_versions")
      .select("question_id, version, conflict_note")
      .in("question_id", chunk.map((v) => v.id));
    if (error) throw new Error(`Could not read the conflict notes: ${error.message}`);
    for (const row of data) notes.set(`${row.question_id}:${row.version}`, row.conflict_note);
  }
  return notes;
}

/**
 * Bank questions. Which ones the user may see is decided by `db`, the caller's
 * own client under row level security (students: active and flagged only), and
 * only through columns that client may read. Whether a question has a conflict
 * note is then read with `service` for those questions alone. Oldest first.
 */
export async function listQuestionsFor(db: Db, service: Db, filter: BankFilter): Promise<BankListItem[]> {
  let query = db
    .from("questions")
    .select(
      "id, type, status, difficulty, current_version, topics!inner(name), question_versions!inner(version, stem, source_refs)",
    );
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.type) query = query.eq("type", filter.type);
  if (filter.topicId) query = query.eq("topic_id", filter.topicId);
  if (filter.difficulty) query = query.eq("difficulty", filter.difficulty);
  if (filter.documentId) {
    // Narrows in the database to questions any version of which cites the
    // handout; the current version is checked below.
    query = query.filter(
      "question_versions.source_refs",
      "cs",
      JSON.stringify([{ documentId: filter.documentId }]),
    );
  }
  const { data, error } = await query.order("created_at").order("id");
  if (error) throw new Error(`Could not read the question bank: ${error.message}`);

  const rows = data.flatMap((row) => {
    const version = currentOf(row.question_versions, row.current_version);
    if (!version) return [];
    const refs = parseRefs(version.source_refs);
    if (filter.documentId && !refs.some((ref) => ref.documentId === filter.documentId)) return [];
    return [{ row, version, refs }];
  });
  const notes = await loadConflictNotes(
    service,
    rows.map(({ row }) => ({ id: row.id, version: row.current_version })),
  );
  return rows.map(({ row, version, refs }) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    difficulty: row.difficulty,
    topicName: row.topics.name,
    stem: version.stem,
    sourceLabel: sourceLabelOf(refs),
    hasConflictNote: Boolean(notes.get(`${row.id}:${row.current_version}`)?.trim()),
  }));
}

/**
 * One question. `db` is the caller's own client: it decides whether the question
 * is visible (RLS) and supplies the visible columns and the caller's flags
 * (all open flags for an admin, their own for a student). The conflict note is
 * then read with `service` for that question, for everyone. With `isAdmin`
 * (the caller has passed the admin check) it also adds the review notes and the
 * answer key of the current version. A student never gets either.
 */
export async function questionDetailFor(
  db: Db,
  service: Db,
  id: string,
  isAdmin: boolean,
): Promise<QuestionDetail> {
  if (!UUID.test(id)) throw new BankError(NOT_FOUND);
  const { data, error } = await db
    .from("questions")
    .select(
      "id, type, status, difficulty, current_version, topics!inner(name), question_versions(version, stem, options, source_refs)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the question: ${error.message}`);
  const version = data && currentOf(data.question_versions, data.current_version);
  if (!data || !version) throw new BankError(NOT_FOUND);

  const { data: flags, error: flagsError } = await db
    .from("question_flags")
    .select("comment, created_at")
    .eq("question_id", id)
    .is("resolved_at", null)
    .order("created_at");
  if (flagsError) throw new Error(`Could not read the flags: ${flagsError.message}`);

  // Everything below runs for a question the user is already allowed to see.
  const { data: hidden, error: hiddenError } = await service
    .from("question_versions")
    .select("conflict_note, review_notes, answer_keys(correct_option_id, explanation, model_answer, key_concepts, rubric)")
    .eq("question_id", id)
    .eq("version", version.version)
    .single();
  if (hiddenError) throw new Error(`Could not read the question's notes: ${hiddenError.message}`);

  const key = hidden.answer_keys;
  return {
    id: data.id,
    type: data.type,
    status: data.status,
    version: version.version,
    versionCount: data.question_versions.length,
    difficulty: data.difficulty,
    topicName: data.topics.name,
    stem: version.stem,
    options: parseOptions(version.options),
    sourceRefs: parseRefs(version.source_refs).map((ref) => ({ ...ref, label: refHeading(ref) })),
    conflictNote: hidden.conflict_note,
    reviewNotes: isAdmin ? hidden.review_notes : [],
    flags: flags.map((f) => ({ comment: f.comment.trim() || null, createdAt: f.created_at })),
    key:
      isAdmin && key
        ? {
            correctOptionId: key.correct_option_id,
            explanation: key.explanation,
            modelAnswer: key.model_answer,
            keyConcepts: parseKeyConcepts(key.key_concepts),
            rubric: RubricSchema.safeParse(key.rubric).data ?? null,
          }
        : null,
  };
}

// ----------------------------------------------------------------- writes

type QuestionState = {
  id: string;
  type: "mcq" | "saq" | "essay";
  status: QuestionStatus;
  difficulty: Difficulty;
  topicName: string;
  version: number;
  stem: string;
  options: Option[] | null;
  sourceRefs: SourceRef[];
  basisQuote: string;
  conflictNote: string | null;
  key: {
    correctOptionId: string | null;
    explanation: string | null;
    modelAnswer: string | null;
    keyConcepts: KeyConcept[] | null;
    rubric: Rubric | null;
  };
};

/** The question's current version and key, read with the service client. */
async function loadState(service: Db, id: string): Promise<QuestionState> {
  if (!UUID.test(id)) throw new BankError(NOT_FOUND);
  const { data, error } = await service
    .from("questions")
    .select(
      "id, type, status, difficulty, current_version, topics!inner(name), question_versions(version, stem, options, source_refs, basis_quote, conflict_note, answer_keys(correct_option_id, explanation, model_answer, key_concepts, rubric))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the question: ${error.message}`);
  const version = data && currentOf(data.question_versions, data.current_version);
  if (!data || !version) throw new BankError(NOT_FOUND);
  const key = version.answer_keys;
  return {
    id: data.id,
    type: data.type,
    status: data.status,
    difficulty: data.difficulty,
    topicName: data.topics.name,
    version: version.version,
    stem: version.stem,
    options: parseOptions(version.options),
    sourceRefs: parseRefs(version.source_refs),
    basisQuote: version.basis_quote,
    conflictNote: version.conflict_note,
    key: {
      correctOptionId: key?.correct_option_id ?? null,
      explanation: key?.explanation ?? null,
      modelAnswer: key?.model_answer ?? null,
      keyConcepts: parseKeyConcepts(key?.key_concepts),
      rubric: RubricSchema.safeParse(key?.rubric).data ?? null,
    },
  };
}

const STATUS_PHRASE: Record<QuestionStatus, string> = {
  draft: "still being checked",
  needs_review: "waiting for review",
  active: "active",
  flagged: "flagged",
  retired: "retired",
};

const ACTION_PHRASE: Partial<Record<LifecycleAction, string>> = {
  approve: "approved",
  reject: "rejected",
  edit: "edited",
  regenerate: "regenerated",
  flag: "flagged",
};

/** The lifecycle's decision, with an illegal move turned into a message for the user. */
function decide(status: QuestionStatus, action: LifecycleAction, actor: Actor) {
  try {
    return transition(status, action, actor);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new BankError(
        `This question is ${STATUS_PHRASE[status]}, so it can't be ${ACTION_PHRASE[action] ?? action}.`,
      );
    }
    throw error;
  }
}

async function setStatus(
  service: Db,
  id: string,
  from: QuestionStatus,
  to: QuestionStatus,
  note: string | null,
): Promise<boolean> {
  const { data, error } = await service.rpc("set_question_status", {
    p_question_id: id,
    p_from: from,
    p_to: to,
    p_note: note ?? "",
  });
  if (error) throw new Error(`Could not update the question: ${error.message}`);
  return data;
}

export async function approveRecord(service: Db, id: string): Promise<void> {
  const state = await loadState(service, id);
  const { to } = decide(state.status, "approve", "admin");
  if (!(await setStatus(service, id, state.status, to, null))) throw new BankError(CHANGED);
}

export async function rejectRecord(service: Db, id: string, reason: string): Promise<void> {
  const text = reason.replace(/\s+/g, " ").trim();
  if (!text) throw new BankError("Give a reason for rejecting this question");
  if (text.length > MAX_REASON_CHARS) {
    throw new BankError(`Keep the reason under ${MAX_REASON_CHARS} characters`);
  }
  const state = await loadState(service, id);
  const { to } = decide(state.status, "reject", "admin");
  if (!(await setStatus(service, id, state.status, to, `Rejected: ${text}`))) throw new BankError(CHANGED);
}

/**
 * Records a flag from `user`. An active question becomes flagged; an already
 * flagged one just gains the flag. Students can only flag what they can see
 * (active or flagged). The flag is written first, so a lost race never leaves a
 * flagged question with no flag.
 */
export async function flagRecord(
  service: Db,
  user: { id: string; role: "student" | "admin" },
  id: string,
  comment: string | null,
): Promise<void> {
  const text = comment?.trim() ?? "";
  if (text.length > MAX_COMMENT_CHARS) {
    throw new BankError(`Keep the comment under ${MAX_COMMENT_CHARS} characters`);
  }
  const state = await loadState(service, id);
  if (user.role === "student" && state.status !== "active" && state.status !== "flagged") {
    throw new BankError(NOT_FOUND);
  }
  const needsMove = state.status !== "flagged";
  const to = needsMove ? decide(state.status, "flag", user.role).to : state.status;

  const { error } = await service
    .from("question_flags")
    .insert({ question_id: id, user_id: user.id, comment: text });
  if (error) throw new Error(`Could not save the flag: ${error.message}`);

  if (needsMove && !(await setStatus(service, id, state.status, to, null))) {
    const now = await loadState(service, id);
    if (now.status !== "flagged") throw new BankError(CHANGED);
  }
}

function throwIfAny(issues: string[]): void {
  if (issues.length > 0) throw new BankError(issues.join(". "), issues);
}

/** The edited question's text and key, validated; throws a BankError listing every problem. */
export function buildEditedQuestion(
  current: Pick<QuestionState, "type" | "options"> & QuestionState["key"],
  edit: QuestionEdit,
): { stem: string; options: Option[] | null; key: Record<string, Json> } {
  const stem = edit.stem.trim();
  if (!stem) throw new BankError("Write the question text");
  const common = {
    stem,
    difficulty: edit.difficulty,
    source_slide_ids: [] as string[],
    basis_quote: "",
    conflict_note: null,
  };

  if (current.type === "mcq") {
    const parsed = GeneratedMcqSchema.safeParse({
      ...common,
      options: edit.options ?? current.options ?? [],
      correct_option_id: edit.correctOptionId ?? current.correctOptionId,
      explanation: edit.explanation ?? current.explanation ?? "",
    });
    if (!parsed.success) {
      throw new BankError("An MCQ needs options a, b, c, d and a correct answer that is one of them");
    }
    const q: GeneratedMcq = parsed.data;
    const issues = validateStructure(q);
    if (q.options.some((o) => !o.text.trim())) issues.push("Every option needs text");
    throwIfAny(issues);
    return {
      stem,
      options: q.options.map((o) => ({ id: o.id, text: o.text.trim() })),
      key: {
        correct_option_id: q.correct_option_id,
        explanation: q.explanation.trim(),
        model_answer: null,
        key_concepts: null,
        rubric: null,
      },
    };
  }

  if (current.type === "saq") {
    const parsed = GeneratedSaqSchema.safeParse({
      ...common,
      model_answer: edit.modelAnswer ?? current.modelAnswer ?? "",
      key_concepts: edit.keyConcepts ?? current.keyConcepts ?? [],
      rubric: edit.rubric ?? current.rubric,
    });
    if (!parsed.success) throw new BankError("An SAQ needs a model answer, key concepts and a rubric");
    const q: GeneratedSaq = parsed.data;
    throwIfAny(validateStructure(q));
    return {
      stem,
      options: null,
      key: {
        correct_option_id: null,
        explanation: null,
        model_answer: q.model_answer.trim(),
        key_concepts: q.key_concepts,
        rubric: q.rubric,
      },
    };
  }
  throw new BankError("Essay questions cannot be edited here");
}

function versionError(message: string): Error {
  if (/Version changed/.test(message)) return new BankError(STALE);
  return /cannot get a new version/.test(message)
    ? new BankError(CHANGED)
    : new Error(`Could not save the new version: ${message}`);
}

/** Saves an admin's edit as the next version (the old one and its key are kept) and makes it active. */
export async function editRecord(
  service: Db,
  id: string,
  edit: QuestionEdit,
  expectedVersion: number,
): Promise<{ version: number }> {
  const state = await loadState(service, id);
  if (state.version !== expectedVersion) throw new BankError(STALE);
  const { to } = decide(state.status, "edit", "admin");
  const built = buildEditedQuestion({ type: state.type, options: state.options, ...state.key }, edit);
  const { data, error } = await service.rpc("create_question_version", {
    p_question_id: id,
    p_version: {
      stem: built.stem,
      options: built.options,
      source_refs: state.sourceRefs,
      basis_quote: state.basisQuote,
      conflict_note: state.conflictNote,
      review_notes: [],
      difficulty: edit.difficulty,
    },
    p_key: built.key,
    p_status: to,
    p_expected_version: expectedVersion,
  });
  if (error) throw versionError(error.message);
  return { version: data };
}

/**
 * Writes a replacement for the question from the slides it cites: at most one
 * question of the same type, the current stem to avoid, saved as the next version
 * (draft), then checked like any new draft (pre-checks, duplicates, verifier).
 * Nothing is saved when the model writes nothing usable. A check that cannot
 * finish (an AI error) puts the new version in needs_review with a note rather
 * than leaving it a draft nobody can act on. Returns the status it ends in.
 */
export async function regenerateRecord(
  service: Db,
  ai: AiClient,
  id: string,
  expectedVersion: number,
): Promise<{ status: QuestionStatus }> {
  const state = await loadState(service, id);
  if (state.version !== expectedVersion) throw new BankError(STALE);
  const { to } = decide(state.status, "regenerate", "admin");
  if (state.type === "essay") throw new BankError("Essay questions cannot be regenerated here");

  const slides = await loadCitedSlides(
    service,
    state.sourceRefs.map((ref) => ref.slideId),
  );
  if (slides.length === 0) {
    throw new BankError("The slides this question is based on are no longer available");
  }
  const documentId = state.sourceRefs[0].documentId;
  const pageDocs = await loadPagePhotos(service, slides);
  const result = await generateForTopic(
    {
      topicName: state.topicName,
      slides,
      pageDocs,
      avoidStems: [state.stem],
      maxMcq: state.type === "mcq" ? 1 : 0,
      maxSaq: state.type === "saq" ? 1 : 0,
      batchIndex: state.version + 1,
    },
    ai,
    documentId,
  );
  const written = state.type === "mcq" ? result.mcqs[0] : result.saqs[0];
  if (!written) {
    throw new BankError(
      "The AI could not write a replacement from these slides. Try again, or edit the question yourself.",
    );
  }

  const bySlide = new Map(slides.map((s) => [s.id, s]));
  const cited = written.source_slide_ids.flatMap((slideId) => {
    const slide = bySlide.get(slideId);
    if (!slide) return [];
    const documentOf = state.sourceRefs.find((ref) => ref.slideId === slideId)?.documentId ?? documentId;
    return [{ documentId: documentOf, pageNo: slide.pageNo, slideId, label: slide.label }];
  });
  const notes = validateGenerated(written, bySlide).map((issue) => `${AUTO_CHECK_PREFIX}${issue}`);
  const mcq = "options" in written ? written : null;
  const saq = "model_answer" in written ? written : null;

  const { data: version, error } = await service.rpc("create_question_version", {
    p_question_id: id,
    p_version: {
      stem: written.stem,
      options: mcq?.options ?? null,
      source_refs: cited.length > 0 ? cited : state.sourceRefs,
      basis_quote: written.basis_quote,
      conflict_note: written.conflict_note,
      review_notes: notes,
      difficulty: written.difficulty,
    },
    p_key: {
      correct_option_id: mcq?.correct_option_id ?? null,
      explanation: mcq?.explanation ?? null,
      model_answer: saq?.model_answer ?? null,
      key_concepts: saq?.key_concepts ?? null,
      rubric: saq?.rubric ?? null,
    },
    p_status: to,
    p_expected_version: expectedVersion,
  });
  if (error) throw versionError(error.message);

  try {
    return { status: await processDraftQuestion(id, { db: service, ai, documentId }) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const { to: next } = decide("draft", "verify_fail", "system");
    const { data: moved, error: moveError } = await service.rpc("record_question_check", {
      p_question_id: id,
      p_version: version,
      p_status: next,
      p_notes: [
        `${VERIFIER_PREFIX}the check did not finish (${message}). Review this question yourself or regenerate it.`,
      ],
      p_conflict_note: "",
    });
    if (moveError) throw new Error(`Could not save the check of question ${id}: ${moveError.message}`);
    return { status: moved ? next : (await loadState(service, id)).status };
  }
}
