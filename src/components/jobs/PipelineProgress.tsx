"use client";

import type { JobSnapshot } from "@/modules/jobs/types";

const STAGE_LABELS: Record<string, string> = {
  split: "Splitting pages",
  extract: "Reading slides",
  topic_map: "Finding topics",
  generate: "Writing questions",
  verify: "Checking questions",
};

export function PipelineProgress({
  snapshot,
  onRetry,
}: {
  snapshot: JobSnapshot | null;
  onRetry: () => void;
}) {
  if (!snapshot) return null;
  const { progress, status, error, kind } = snapshot;
  const percent =
    status === "done"
      ? 100
      : progress && progress.total > 0
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : 0;
  const stage = STAGE_LABELS[kind] ?? kind;

  return (
    <section aria-label="Progress" className="rounded-lg border-2 border-zinc-300 p-4">
      <h2 className="text-lg font-bold">{stage}</h2>
      <div
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="my-3 h-4 w-full overflow-hidden rounded-full bg-zinc-200"
      >
        <div
          className={`h-full ${status === "failed" ? "bg-red-700" : "bg-blue-900"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {progress ? <p>{progress.label}</p> : null}
      {status === "failed" ? (
        <div role="alert" className="mt-3">
          <p className="font-bold text-red-800">{error ?? "Something went wrong."}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 min-h-14 min-w-48 rounded-lg bg-blue-900 px-6 text-xl font-bold text-white hover:bg-blue-800"
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
