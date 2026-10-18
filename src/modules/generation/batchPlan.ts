import type { Json } from "@/lib/supabase/database.types";

// How the generate stage isolates one bad batch (R37). A batch whose answer is
// cut off (or that times out, or keeps failing) is split in half; the halves get
// the keys `<key>.a` and `<key>.b`, recorded in the run's report so every later
// step and re-run expands the plan the same way. A single slide that still fails
// on the job's last attempt is skipped and recorded there too.

/** A batch the generator set aside, as stored in generation_runs.report.skippedBatches. */
export type SkippedBatch = {
  batchKey: string;
  slideIds: string[];
  slideLabels: string[];
  /** Plain words, e.g. "the AI's answer was cut off". */
  reason: string;
};

export type RunReport = { splitBatches: string[]; skippedBatches: SkippedBatch[] };

/** The two halves of a batch, in order; the first takes the odd slide. */
export function halves<T>(items: T[]): [T[], T[]] {
  const cut = Math.ceil(items.length / 2);
  return [items.slice(0, cut), items.slice(cut)];
}

/**
 * The plan with every split batch replaced, in place, by its halves (recursively:
 * a half can be split again). Batches of one slide are never split.
 */
export function expandSplitBatches<B extends { batchKey: string; slides: unknown[] }>(
  plan: B[],
  splitKeys: ReadonlySet<string>,
  make: (parent: B, slides: B["slides"], batchKey: string) => B,
): B[] {
  const expand = (batch: B): B[] => {
    if (!splitKeys.has(batch.batchKey) || batch.slides.length < 2) return [batch];
    const [a, b] = halves(batch.slides);
    return [
      ...expand(make(batch, a as B["slides"], `${batch.batchKey}.a`)),
      ...expand(make(batch, b as B["slides"], `${batch.batchKey}.b`)),
    ];
  };
  return plan.flatMap(expand);
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

function isSkippedBatch_(value: unknown): value is SkippedBatch {
  const v = value as Partial<SkippedBatch> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.batchKey === "string" &&
    isStringArray(v.slideIds) &&
    isStringArray(v.slideLabels) &&
    typeof v.reason === "string"
  );
}

/** The split keys and skipped batches of a generation run's report (anything odd is ignored). */
export function readRunReport(report: Json | null | undefined): RunReport {
  const r = report && typeof report === "object" && !Array.isArray(report) ? report : {};
  return {
    splitBatches: isStringArray(r.splitBatches) ? r.splitBatches : [],
    skippedBatches: Array.isArray(r.skippedBatches) ? r.skippedBatches.filter(isSkippedBatch_) : [],
  };
}

/** Whether this batch (same key, same slides) was skipped earlier. */
export function isSkippedBatch(skipped: SkippedBatch[], batchKey: string, slideIds: string[]): boolean {
  return skipped.some(
    (s) =>
      s.batchKey === batchKey &&
      s.slideIds.length === slideIds.length &&
      s.slideIds.every((id, i) => id === slideIds[i]),
  );
}
