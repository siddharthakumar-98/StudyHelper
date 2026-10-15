import { AiError } from "@/modules/ai/errors";
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

/** Puts a failed job back to pending so the next step call retries it. */
export async function resetJob(store: JobStore, jobId: string): Promise<JobSnapshot> {
  const row = await store.get(jobId);
  const reset: JobRow = {
    ...row,
    status: "pending",
    attempts: 0,
    error: null,
    locked_until: null,
  };
  await store.save(reset);
  return toSnapshot(reset);
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

  // Every path below ends in exactly one save that clears locked_until.
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
        payload: (claimed.payload as Record<string, unknown>) ?? {},
        ai: deps.ai,
        db: deps.db,
      });
      outcome = {
        ...claimed,
        step: claimed.step + 1,
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
      const attempts = claimed.attempts + 1;
      const permanent = err instanceof AiError && !err.retryable;
      outcome = {
        ...claimed,
        attempts,
        error: err instanceof Error ? err.message : String(err),
        status: permanent || attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      };
    }
  }
  outcome.locked_until = null;
  await store.save(outcome);
  return { snapshot: toSnapshot(outcome), ran: true };
}

export async function runJobStep(
  store: JobStore,
  handlers: Partial<Record<JobKind, JobHandler>>,
  jobId: string,
  deps: StepDeps,
): Promise<JobSnapshot> {
  return (await runJobStepDetailed(store, handlers, jobId, deps)).snapshot;
}
