import type { JobSnapshot } from "@/modules/jobs/types";

export const LOCKED_POLL_MS = 1500;

export type RunnerDecision =
  | { action: "stop" }
  | { action: "post"; id: string; delayMs: number };

/** What the runner does after a step returned `snapshot`. */
export function decideNext(snapshot: JobSnapshot): RunnerDecision {
  switch (snapshot.status) {
    case "failed":
      return { action: "stop" };
    case "done":
      return snapshot.nextJobId
        ? { action: "post", id: snapshot.nextJobId, delayMs: 0 }
        : { action: "stop" };
    case "running":
      // Another tab or the cron sweep holds the lock; poll gently.
      return { action: "post", id: snapshot.id, delayMs: LOCKED_POLL_MS };
    default:
      return { action: "post", id: snapshot.id, delayMs: 0 };
  }
}

/**
 * Which job a (re)start should POST to. After a failure that is the failed job
 * itself, which may be later in the chain than the job the runner was given.
 */
export function startJobId(jobId: string, latest: JobSnapshot | null): string {
  return latest?.status === "failed" ? latest.id : jobId;
}

/** How long the runner waits before re-sending a step after a transient failure. */
export const TRANSIENT_RETRY_DELAYS_MS = [2000, 5000, 10000];

/**
 * The wait before re-sending a step that failed in transit (`status` null: a
 * network error) or on the server (5xx), after `retriesSoFar` such retries; null
 * when the runner should stop and show the failure (a sign-out, any other client
 * error, or the retries are used up). The engine makes a repeated POST safe.
 */
export function transientRetryDelay(status: number | null, retriesSoFar: number): number | null {
  const transient = status === null || status >= 500;
  if (!transient) return null;
  return TRANSIENT_RETRY_DELAYS_MS[retriesSoFar] ?? null;
}
