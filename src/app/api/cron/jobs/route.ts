import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAiClient } from "@/modules/ai/usage";
import { runJobStepDetailed } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { SupabaseJobStore } from "@/modules/jobs/store";
import { sweepJobs } from "@/modules/jobs/sweep";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Advances unfinished jobs, oldest first, starting steps only in the first 20 s
 * (sweepJobs), so the last step started still ends inside maxDuration.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = createServiceSupabase();
  const store = new SupabaseJobStore(db);
  const deps = { ai: getAiClient(), db };

  const { data: jobs, error } = await db
    .from("jobs")
    .select("id")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const steps = await sweepJobs(
    jobs.map((j) => j.id),
    (id) => runJobStepDetailed(store, JOB_HANDLERS, id, deps),
  );
  return NextResponse.json({ steps, elapsedMs: Date.now() - startedAt });
}
