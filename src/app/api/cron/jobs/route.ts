import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAiClient } from "@/modules/ai/usage";
import { runJobStepDetailed } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { SupabaseJobStore } from "@/modules/jobs/store";

export const maxDuration = 300;

const BUDGET_MS = 240_000;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Sweeps unfinished jobs, oldest first, until the time budget is spent. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = createServiceSupabase();
  const store = new SupabaseJobStore(db);
  const deps = { ai: getAiClient(), db };
  const timeLeft = () => Date.now() - startedAt < BUDGET_MS;

  const { data: jobs, error } = await db
    .from("jobs")
    .select("id")
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let steps = 0;
  for (const { id } of jobs) {
    let nextId: string | null = id;
    // Follow a finished job into its successor while time remains.
    while (nextId && timeLeft()) {
      const { snapshot, ran } = await runJobStepDetailed(store, JOB_HANDLERS, nextId, deps);
      if (!ran) break; // locked by a browser tab, or finished elsewhere
      steps += 1;
      if (snapshot.status === "done") {
        nextId = snapshot.nextJobId;
      } else if (snapshot.status === "failed" || snapshot.error) {
        break; // leave a flaky job for the next sweep rather than hammering it
      }
    }
    if (!timeLeft()) break;
  }

  return NextResponse.json({ steps, elapsedMs: Date.now() - startedAt });
}
