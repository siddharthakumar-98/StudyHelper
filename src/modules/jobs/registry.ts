import { extractHandler, splitHandler } from "@/modules/ingestion/handlers";
import type { JobHandler, JobKind } from "./types";

/** Later tasks add one line each: topic_map, generate, verify. */
export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  split: splitHandler,
  extract: extractHandler,
};
