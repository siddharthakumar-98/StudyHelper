import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { ForbiddenError, requireAdmin } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAiClient } from "@/modules/ai/usage";
import { resetJob, runJobStep } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { SupabaseJobStore } from "@/modules/jobs/store";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    // requireUser redirects when there is no session; answer API callers with JSON.
    if (isRedirectError(err)) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    throw err;
  }

  const { id } = await params;
  const db = createServiceSupabase();
  const store = new SupabaseJobStore(db);

  try {
    await store.get(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { retry?: unknown } | null;
  if (body?.retry === true) {
    // Conditional in the database: only a still-failed job is reset.
    await resetJob(store, id);
  }

  const snapshot = await runJobStep(store, JOB_HANDLERS, id, { ai: getAiClient(), db });
  return NextResponse.json(snapshot);
}
