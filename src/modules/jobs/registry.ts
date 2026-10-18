import { generateHandler, topicMapHandler, verifyHandler } from "@/modules/generation/handlers";
import { extractHandler, splitHandler } from "@/modules/ingestion/handlers";
import type { JobHandler, JobKind } from "./types";

export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  split: splitHandler,
  extract: extractHandler,
  topic_map: topicMapHandler,
  generate: generateHandler,
  verify: verifyHandler,
};
