const STATUS_LABELS: Record<string, string> = {
  uploading: "Upload not finished",
  splitting: "Preparing pages",
  processing: "Reading slides",
  review: "Checking slides",
  ready: "Ready",
};

/** What a processing handout is doing, by the kind of its newest job (item 12). */
const STAGE_LABELS: Record<string, string> = {
  split: "Preparing pages",
  extract: "Reading slides",
  topic_map: "Finding topics",
  generate: "Writing questions",
  verify: "Checking questions",
};

/** The admin's label while the slides wait for their check (R38). */
export const ADMIN_REVIEW_LABEL = "Slides are ready to check";

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatClassDate(value: string | null): string {
  if (!value) return "No date";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

export const STUDENT_PREPARING_COPY =
  "This handout is still being prepared. Slides appear below as they are read.";
export const STUDENT_ATTENTION_COPY =
  "This handout needs attention before its slides are ready. Please check back later.";
export const STUDENT_REVIEWING_COPY = "Slides are being checked before questions are written.";

export type JobState = { id: string; status: "pending" | "running" | "done" | "failed"; kind: string };

export type DocumentStatusView = {
  label: string;
  /** What a student is told while the handout is not ready. */
  studentNotice: "preparing" | "attention" | "reviewing" | null;
  /** The job an admin's browser should drive, or null. */
  runnerJobId: string | null;
  /** Whether the page should refresh itself on a timer (nothing else will update it). */
  poll: boolean;
  /** Whether the admin gets the "Write questions" button (slides waiting for their check, R38). */
  writeQuestions: boolean;
};

/**
 * Everything the handout page shows about pipeline state, derived from one pair of
 * reads (the newest job, then the document). The document is read after the job, so
 * a step that finishes in between can only make the document look newer than the job,
 * never older: "ready" always wins, and the stale case is a job that is still open
 * for a document that is already ready, which needs no runner.
 */
export function documentStatusView(input: {
  docStatus: string;
  latestJob: JobState | null;
  isAdmin: boolean;
  /** The ?job= the upload form (or the Write questions button) handed over (admins only). */
  requestedJobId?: string | null;
}): DocumentStatusView {
  const { docStatus, latestJob, isAdmin, requestedJobId } = input;
  if (docStatus === "ready") {
    return { label: statusLabel(docStatus), studentNotice: null, runnerJobId: null, poll: false, writeQuestions: false };
  }
  const openJobId = latestJob && latestJob.status !== "done" ? latestJob.id : null;

  // Extraction is done and nothing runs until the admin starts question writing.
  if (docStatus === "review" && openJobId === null) {
    return isAdmin
      ? { label: ADMIN_REVIEW_LABEL, studentNotice: null, runnerJobId: null, poll: false, writeQuestions: true }
      : { label: statusLabel(docStatus), studentNotice: "reviewing", runnerJobId: null, poll: true, writeQuestions: false };
  }

  const label =
    docStatus === "processing" && latestJob && STAGE_LABELS[latestJob.kind]
      ? STAGE_LABELS[latestJob.kind]
      : statusLabel(docStatus);
  // An open job wins over the ?job= in the URL, which may name an earlier chain
  // (the upload's split job) that ended at the slide check.
  const runnerJobId = isAdmin ? (openJobId ?? requestedJobId ?? null) : null;
  const waiting = docStatus !== "uploading";
  const studentNotice = isAdmin || !waiting
    ? null
    : latestJob?.status === "failed"
      ? "attention"
      : "preparing";
  const poll = waiting && (!isAdmin || runnerJobId === null);
  return { label, studentNotice, runnerJobId, poll, writeQuestions: false };
}
