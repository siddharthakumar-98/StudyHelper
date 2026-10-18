import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { JobKind, JobRow, JobStore } from "./types";

export class SupabaseJobStore implements JobStore {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async claim(id: string, lockSeconds: number): Promise<JobRow | null> {
    const { data, error } = await this.db.rpc("claim_job", {
      p_job_id: id,
      p_lock_seconds: lockSeconds,
    });
    if (error) throw new Error(`claim_job failed: ${error.message}`);
    // A composite-returning function yields an all-null record when nothing matched.
    return data && data.id ? data : null;
  }

  async save(row: JobRow, fenceLockedUntil: string | null): Promise<boolean> {
    const { id, created_at: _created, ...fields } = row;
    void _created;
    let query = this.db
      .from("jobs")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
    query =
      fenceLockedUntil === null
        ? query.is("locked_until", null)
        : query.eq("locked_until", fenceLockedUntil);
    const { data, error } = await query.select("id");
    if (error) throw new Error(`job save failed: ${error.message}`);
    return data.length > 0;
  }

  async release(id: string, fenceLockedUntil: string | null): Promise<void> {
    if (fenceLockedUntil === null) return;
    const { error } = await this.db
      .from("jobs")
      .update({ locked_until: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("locked_until", fenceLockedUntil);
    if (error) throw new Error(`job release failed: ${error.message}`);
  }

  async reset(id: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("jobs")
      .update({
        status: "pending",
        attempts: 0,
        error: null,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "failed")
      .select("id");
    if (error) throw new Error(`job reset failed: ${error.message}`);
    return data.length > 0;
  }

  async insert(
    kind: JobKind,
    documentId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await this.db
      .from("jobs")
      .insert({ kind, document_id: documentId, payload: payload as NonNullable<Json> })
      .select("id")
      .single();
    if (error) throw new Error(`job insert failed: ${error.message}`);
    return data.id;
  }

  async get(id: string): Promise<JobRow> {
    const { data, error } = await this.db.from("jobs").select("*").eq("id", id).single();
    if (error) throw new Error(`job ${id} not found: ${error.message}`);
    return data;
  }
}

/** In-process store with the same claim semantics as claim_job; for unit tests. */
export class MemoryJobStore implements JobStore {
  private readonly rows = new Map<string, JobRow>();

  async claim(id: string, lockSeconds: number): Promise<JobRow | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const now = Date.now();
    const lockedUntil = row.locked_until ? Date.parse(row.locked_until) : 0;
    if (row.status !== "pending" && row.status !== "running") return null;
    if (lockedUntil >= now) return null;
    if (row.attempts >= 3) {
      row.status = "failed";
      row.error = "This step stopped unexpectedly 3 times. Please try again.";
      row.locked_until = null;
      return null;
    }
    row.status = "running";
    row.attempts += 1;
    row.locked_until = new Date(now + lockSeconds * 1000).toISOString();
    row.updated_at = new Date(now).toISOString();
    return { ...row };
  }

  async save(row: JobRow, fenceLockedUntil: string | null): Promise<boolean> {
    const current = this.rows.get(row.id);
    if (!current || current.locked_until !== fenceLockedUntil) return false;
    this.rows.set(row.id, { ...row, updated_at: new Date().toISOString() });
    return true;
  }

  async release(id: string, fenceLockedUntil: string | null): Promise<void> {
    const row = this.rows.get(id);
    if (row && fenceLockedUntil !== null && row.locked_until === fenceLockedUntil) {
      row.locked_until = null;
    }
  }

  async reset(id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.status !== "failed") return false;
    Object.assign(row, { status: "pending", attempts: 0, error: null, locked_until: null });
    return true;
  }

  async insert(
    kind: JobKind,
    documentId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.rows.set(id, {
      id,
      kind,
      document_id: documentId,
      payload: payload as NonNullable<Json>,
      step: 0,
      status: "pending",
      progress: null,
      attempts: 0,
      error: null,
      locked_until: null,
      next_job_id: null,
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  async get(id: string): Promise<JobRow> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`job ${id} not found`);
    return { ...row };
  }
}
