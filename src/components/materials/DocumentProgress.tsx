"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { PipelineProgress } from "@/components/jobs/PipelineProgress";
import { useJobRunner } from "@/components/jobs/useJobRunner";

/** Drives the handout's job chain from the browser and refreshes the page as stages finish. */
export function DocumentProgress({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { snapshot, retry } = useJobRunner(jobId);
  const lastRefresh = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    // The page list changes once splitting is done (and every later stage after it).
    if (snapshot.kind === "split" && snapshot.status !== "done") return;
    const key = `${snapshot.kind}:${snapshot.status}`;
    if (lastRefresh.current === key) return;
    lastRefresh.current = key;
    router.refresh();
  }, [snapshot, router]);

  return <PipelineProgress snapshot={snapshot} onRetry={retry} />;
}
