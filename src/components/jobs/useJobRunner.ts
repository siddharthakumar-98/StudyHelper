"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobSnapshot } from "@/modules/jobs/types";

const LOCKED_POLL_MS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function failedSnapshot(id: string, previous: JobSnapshot | null, error: string): JobSnapshot {
  return {
    id,
    kind: previous?.kind ?? "",
    progress: previous?.progress ?? null,
    nextJobId: null,
    attempts: previous?.attempts ?? 0,
    status: "failed",
    error,
  };
}

/** Drives a job to completion from the browser, one POST per step, following nextJobId. */
export function useJobRunner(jobId: string | null): {
  snapshot: JobSnapshot | null;
  running: boolean;
  retry(): void;
} {
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState({ n: 0, retry: false });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loop(startId: string) {
      let id = startId;
      let retry = attempt.retry;
      let last: JobSnapshot | null = null;
      setRunning(true);
      while (!cancelled) {
        try {
          const res = await fetch(`/api/jobs/${id}/step`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ retry }),
            signal: controller.signal,
          });
          retry = false;
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok || !type.includes("application/json")) {
            throw new Error(
              res.status === 401 || res.redirected
                ? "You have been signed out. Sign in again."
                : `The server returned an error (${res.status}).`,
            );
          }
          last = (await res.json()) as JobSnapshot;
        } catch (err) {
          if (cancelled) return;
          setSnapshot(failedSnapshot(id, last, err instanceof Error ? err.message : "Network error"));
          break;
        }
        if (cancelled) return;
        setSnapshot(last);
        if (last.status === "failed") break;
        if (last.status === "done") {
          if (!last.nextJobId) break;
          id = last.nextJobId;
          continue;
        }
        // "running" means another tab or the cron sweep holds the lock.
        if (last.status === "running") await sleep(LOCKED_POLL_MS);
      }
      if (!cancelled) setRunning(false);
    }

    void loop(jobId);
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `attempt` changes only through retry(); reading its flag here is intentional.
  }, [jobId, attempt]);

  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: true })), []);

  return { snapshot, running, retry };
}
