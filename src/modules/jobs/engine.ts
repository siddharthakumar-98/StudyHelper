import type {
  JobContext,
  JobHandler,
  JobKind,
  JobRow,
  JobSnapshot,
  JobStore,
  Progress,
  StepResult,
} from "./types";

export type { JobSnapshot } from "./types";

export const LOCK_SECONDS = 300;
export const MAX_ATTEMPTS = 3;

export type StepDeps = Pick<JobContext, "ai" | "db">;

export function createJob(
  store: JobStore,
  kind: JobKind,
  documentId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return store.insert(kind, documentId, payload);
}

export function toSnapshot(row: JobRow): JobSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: (row.progress as Progress | null) ?? null,
    error: row.error,
    nextJobId: row.next_job_id,
    attempts: row.attempts,
  };
}

/** Puts a failed job back to pending; a no-op unless it is still failed. */
export async function resetJob(store: JobStore, jobId: string): Promise<JobSnapshot> {
  await store.reset(jobId);
  return toSnapshot(await store.get(jobId));
}

/**
 * Runs one step. `ran` is false when the job could not be claimed (locked by
 * another runner, or already done/failed); the handler is not invoked then.
 */
export async function runJobStepDetailed(
  store: JobStore,
  handlers: Partial<Record<JobKind, JobHandler>>,
  jobId: string,
  deps: StepDeps,
): Promise<{ snapshot: JobSnapshot; ran: boolean }> {
  const claimed = await store.claim(jobId, LOCK_SECONDS);
  if (!claimed) return { snapshot: toSnapshot(await store.get(jobId)), ran: false };

  // Every path below ends in exactly one fenced save that clears locked_until.
  let outcome: JobRow;
  const handler = handlers[claimed.kind as JobKind];
  if (!handler) {
    outcome = { ...claimed, status: "failed", error: `No handler for ${claimed.kind}` };
  } else {
    try {
      const result: StepResult = await handler({
        jobId: claimed.id,
        documentId: claimed.document_id,
        step: claimed.step,
        attempt: claimed.attempts,
        payload: (claimed.payload as Record<string, unknown>) ?? {},
        ai: deps.ai,
        db: deps.db,
      });
      outcome = {
        ...claimed,
        step: !result.done && result.repeatStep ? claimed.step : claimed.step + 1,
        progress: result.progress,
        attempts: 0,
        error: null,
        status: "pending",
      };
      if (result.done) {
        outcome.status = "done";
        if (result.next) {
          outcome.next_job_id = await createJob(
            store,
            result.next.kind,
            claimed.document_id,
            result.next.payload,
          );
        }
      }
    } catch (err) {
      // claim_job already counted this attempt.
      outcome = {
        ...claimed,
        error: err instanceof Error ? err.message : String(err),
        status: claimed.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      };
    }
  }
  outcome.locked_until = null;
  // Fenced on the lock we claimed: if it expired and another runner took over,
  // our result is dropped rather than clobbering theirs.
  const saved = await store.save(outcome, claimed.locked_until);
  const snapshot = saved ? toSnapshot(outcome) : toSnapshot(await store.get(jobId));
  return { snapshot, ran: true };
}

export async function runJobStep(
  store: JobStore,
  handlers: Partial<Record<JobKind, JobHandler>>,
  jobId: string,
  deps: StepDeps,
): Promise<JobSnapshot> {
  return (await runJobStepDetailed(store, handlers, jobId, deps)).snapshot;
}
