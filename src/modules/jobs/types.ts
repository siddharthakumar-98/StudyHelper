import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiClient } from "@/modules/ai/client";
import type { Database } from "@/lib/supabase/database.types";

export type JobKind = "split" | "extract" | "topic_map" | "generate" | "verify";

export type Progress = { current: number; total: number; label: string };

export type StepResult =
  | { done: false; progress: Progress }
  | {
      done: true;
      progress: Progress;
      next?: { kind: JobKind; payload: Record<string, unknown> };
    };

export interface JobContext {
  jobId: string;
  documentId: string;
  step: number;
  payload: Record<string, unknown>;
  ai: AiClient;
  db: SupabaseClient<Database>;
}

export type JobHandler = (ctx: JobContext) => Promise<StepResult>;

export type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

export type JobStatus = "pending" | "running" | "done" | "failed";

export type JobSnapshot = {
  id: string;
  kind: string;
  status: JobStatus;
  progress: Progress | null;
  error: string | null;
  nextJobId: string | null;
  attempts: number;
};

export interface JobStore {
  /** Atomically takes the step lock; null when the job is locked, done or failed. */
  claim(id: string, lockSeconds: number): Promise<JobRow | null>;
  save(row: JobRow): Promise<void>;
  insert(kind: JobKind, documentId: string, payload: Record<string, unknown>): Promise<string>;
  get(id: string): Promise<JobRow>;
}
