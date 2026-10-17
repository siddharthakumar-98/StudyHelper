"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobSnapshot } from "@/modules/jobs/types";
import { decideNext, startJobId, transientRetryDelay } from "./runnerLogic";

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
  const latest = useRef<JobSnapshot | null>(null);
  const head = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    if (head.current !== jobId) {
      head.current = jobId;
      latest.current = null;
    }
    let cancelled = false;
    const controller = new AbortController();

    async function loop() {
      // On a retry this is the failed job, which may be later in the chain.
      let id = startJobId(jobId!, latest.current);
      let retry = attempt.retry;
      let last: JobSnapshot | null = null;
      // Network errors and 5xx answers are retried a few times (2 s, 5 s, 10 s) before
      // the failure is shown: a phone switching networks should not stop the pipeline.
      let transientRetries = 0;
      setRunning(true);
      while (!cancelled) {
        let status: number | null = null;
        try {
          const res = await fetch(`/api/jobs/${id}/step`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ retry }),
            signal: controller.signal,
          });
          status = res.status;
          retry = false;
          const type = res.headers.get("content-type") ?? "";
          if (!res.ok || !type.includes("application/json")) {
            if (res.redirected) status = 401;
            throw new Error(
              status === 401
                ? "You have been signed out. Sign in again."
                : `The server returned an error (${res.status}).`,
            );
          }
          last = (await res.json()) as JobSnapshot;
          transientRetries = 0;
        } catch (err) {
          if (cancelled) return;
          const wait = transientRetryDelay(status, transientRetries);
          if (wait !== null) {
            transientRetries += 1;
            await sleep(wait);
            continue;
          }
          const failed = failedSnapshot(id, last, err instanceof Error ? err.message : "Network error");
          latest.current = failed;
          setSnapshot(failed);
          break;
        }
        if (cancelled) return;
        latest.current = last;
        setSnapshot(last);
        const decision = decideNext(last);
        if (decision.action === "stop") break;
        id = decision.id;
        if (decision.delayMs > 0) await sleep(decision.delayMs);
      }
      if (!cancelled) setRunning(false);
    }

    // Start on the next tick: React StrictMode (dev) mounts, unmounts and re-mounts an
    // effect straight away, and a POST that is aborted right after it was sent still
    // runs on the server (and shows up there as ECONNRESET).
    const start = setTimeout(() => void loop(), 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
      controller.abort();
    };
    // `attempt` changes only through retry(); reading its flag here is intentional.
  }, [jobId, attempt]);

  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: true })), []);

  return { snapshot, running, retry };
}
