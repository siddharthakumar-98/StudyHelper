// Plain-language labels and small pure helpers for the Question Bank pages.
// No server or browser imports, so server and client components share them.

export type Status = "draft" | "needs_review" | "active" | "flagged" | "retired";
export type QType = "mcq" | "saq" | "essay";
export type Difficulty = "easy" | "medium" | "hard";

export type BankSearch = {
  status?: Status;
  type?: "mcq" | "saq";
  difficulty?: Difficulty;
  topicId?: string;
};

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Being checked",
  needs_review: "Needs review",
  active: "Active",
  flagged: "Flagged",
  retired: "Retired",
};

export const TYPE_LABEL: Record<QType, string> = {
  mcq: "MCQ",
  saq: "Short answer",
  essay: "Essay",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** Marks a badge in words as well as colour. */
export const STATUS_BADGE_CLASS: Record<Status, string> = {
  draft: "border-zinc-700 bg-zinc-100 text-zinc-950",
  needs_review: "border-amber-800 bg-amber-100 text-amber-950",
  active: "border-green-800 bg-green-100 text-green-950",
  flagged: "border-red-800 bg-red-100 text-red-950",
  retired: "border-zinc-700 bg-zinc-200 text-zinc-950",
};

export const STATUS_ICON: Record<Status, string> = {
  draft: "…",
  needs_review: "!",
  active: "✓",
  flagged: "⚑",
  retired: "–",
};

const STUDENT_STATUSES: Status[] = ["active", "flagged"];
const ADMIN_STATUSES: Status[] = ["needs_review", "active", "flagged", "retired", "draft"];
const TYPES = ["mcq", "saq"] as const;
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function statusChips(isAdmin: boolean): { value: Status; label: string }[] {
  return (isAdmin ? ADMIN_STATUSES : STUDENT_STATUSES).map((value) => ({
    value,
    label: STATUS_LABEL[value],
  }));
}

export const TYPE_CHIPS: { value: "mcq" | "saq"; label: string }[] = [
  { value: "mcq", label: "MCQ" },
  { value: "saq", label: "Short answer" },
];

export const DIFFICULTY_CHIPS: { value: Difficulty; label: string }[] = DIFFICULTIES.map((value) => ({
  value,
  label: DIFFICULTY_LABEL[value],
}));

type RawParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads ?status=&type=&difficulty=&topic= defensively: anything unexpected is ignored. */
export function parseBankSearch(params: RawParams, isAdmin: boolean): BankSearch {
  const out: BankSearch = {};
  const status = single(params.status);
  if (status && (isAdmin ? ADMIN_STATUSES : STUDENT_STATUSES).includes(status as Status)) {
    out.status = status as Status;
  }
  const type = single(params.type);
  if (type && (TYPES as readonly string[]).includes(type)) out.type = type as "mcq" | "saq";
  const difficulty = single(params.difficulty);
  if (difficulty && DIFFICULTIES.includes(difficulty as Difficulty)) {
    out.difficulty = difficulty as Difficulty;
  }
  const topic = single(params.topic);
  if (topic && UUID.test(topic)) out.topicId = topic;
  return out;
}

/** An admin opens on Needs review while there is something to review. */
export function defaultStatus(isAdmin: boolean, needsReviewCount: number): Status {
  return isAdmin && needsReviewCount > 0 ? "needs_review" : "active";
}

export function bankHref(search: BankSearch): string {
  const query = new URLSearchParams();
  if (search.status) query.set("status", search.status);
  if (search.type) query.set("type", search.type);
  if (search.difficulty) query.set("difficulty", search.difficulty);
  if (search.topicId) query.set("topic", search.topicId);
  const text = query.toString();
  return text ? `/bank?${text}` : "/bank";
}

export function countLabel(n: number): string {
  return `${n} ${n === 1 ? "question" : "questions"}`;
}

export const STALE_COPY = "This question was changed elsewhere. Reload to see the latest version.";

/** The server words a stale page two ways; both mean "reload". */
export function isStaleError(message: string): boolean {
  return /\bchanged\b/i.test(message);
}

export function regenerateMessage(status: Status): string {
  switch (status) {
    case "retired":
      return "The new version repeated an existing question, so it was retired.";
    case "active":
      return "A new version was written and checked. It is now active.";
    case "needs_review":
      return "A new version was written, but it needs your review before it goes into practice tests.";
    default:
      return "A new version was written and is still being checked.";
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";
