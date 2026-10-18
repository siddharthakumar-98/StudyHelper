import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiClient } from "@/modules/ai/client";
import type { Database } from "@/lib/supabase/database.types";

export type JobKind = "split" | "extract" | "topic_map" | "generate" | "verify";

export type Progress = { current: number; total: number; label: string };

export type StepResult =
  | {
      done: false;
      progress: Progress;
      /**
       * Run the same step number again (the handler changed its plan, e.g. split a
       * batch, so this position now holds new work). Counts as a success.
       */
      repeatStep?: boolean;
    }
  | {
      done: true;
      progress: Progress;
      next?: { kind: JobKind; payload: Record<string, unknown> };
    };

export interface JobContext {
  jobId: string;
  documentId: string;
  step: number;
  /**
   * Which attempt at this step this is, 1-based, as counted by the claim. A step
   * that throws on attempt MAX_ATTEMPTS fails the job, so handlers can set one bad
   * item aside on the last attempt instead of blocking the whole handout (R37).
   */
  attempt: number;
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
  /**
   * Atomically takes the step lock and counts the attempt. Null when the job is
   * locked, done or failed (including when this claim exhausted its attempts).
   */
  claim(id: string, lockSeconds: number): Promise<JobRow | null>;
  /**
   * Saves a row only while the caller still holds the lock it claimed
   * (`fenceLockedUntil` is the claimed row's locked_until). False = lock lost,
   * nothing written.
   */
  save(row: JobRow, fenceLockedUntil: string | null): Promise<boolean>;
  /**
   * Clears the step lock while it is still the one claimed (`fenceLockedUntil`);
   * a no-op otherwise. Best-effort cleanup when a save fails.
   */
  release(id: string, fenceLockedUntil: string | null): Promise<void>;
  /** Failed -> pending with attempts 0, atomically. False when the job is not failed. */
  reset(id: string): Promise<boolean>;
  insert(kind: JobKind, documentId: string, payload: Record<string, unknown>): Promise<string>;
  get(id: string): Promise<JobRow>;
}
