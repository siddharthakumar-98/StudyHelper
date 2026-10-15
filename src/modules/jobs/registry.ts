import type { JobHandler, JobKind } from "./types";

/** Later tasks add one line each: split, extract, topic_map, generate, verify. */
export const JOB_HANDLERS: Partial<Record<JobKind, JobHandler>> = {};
