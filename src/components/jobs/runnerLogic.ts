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
