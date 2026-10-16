import { generateHandler, topicMapHandler } from "@/modules/generation/handlers";
import { extractHandler, splitHandler } from "@/modules/ingestion/handlers";
import type { JobHandler, JobKind } from "./types";

/** Task 13 adds verify. */
export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  split: splitHandler,
  extract: extractHandler,
  topic_map: topicMapHandler,
  generate: generateHandler,
};
