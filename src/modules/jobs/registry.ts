import { topicMapHandler } from "@/modules/generation/handlers";
import { extractHandler, splitHandler } from "@/modules/ingestion/handlers";
import type { JobHandler, JobKind } from "./types";

/** Later tasks add one line each: generate, verify. */
export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  split: splitHandler,
  extract: extractHandler,
  topic_map: topicMapHandler,
};
