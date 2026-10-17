"use server";

// Only the server ever runs this file (the client gets action references), and it
// uses the service-role client.
import "server-only";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAiClient } from "@/modules/ai/usage";
import { runAction, type ActionResult } from "./actionResult";
import type { QuestionStatus } from "./lifecycle";
import {
  approveRecord,
  editRecord,
  flagRecord,
  regenerateRecord,
  rejectRecord,
  type QuestionEdit,
} from "./bankService";

// Thin wrappers: every export of a "use server" file is callable from the
// browser, so each one checks the session first and hands the work to bankService.
// Expected failures come back as { ok: false, error, issues? } (runAction);
// unexpected ones still throw.

export async function approveQuestion(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireAdmin();
    await approveRecord(createServiceSupabase(), id);
  });
}

export async function rejectQuestion(id: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireAdmin();
    await rejectRecord(createServiceSupabase(), id, reason);
  });
}

/** `expectedVersion` is the QuestionDetail.version the admin was looking at. */
export async function editQuestion(
  id: string,
  edit: QuestionEdit,
  expectedVersion: number,
): Promise<ActionResult<{ version: number }>> {
  return runAction(async () => {
    await requireAdmin();
    return editRecord(createServiceSupabase(), id, edit, expectedVersion);
  });
}

/**
 * Writes and checks a replacement (up to three AI calls); the page that uses it
 * sets maxDuration = 300. `expectedVersion` is the QuestionDetail.version the
 * admin was looking at.
 */
export async function regenerateQuestion(
  id: string,
  expectedVersion: number,
): Promise<ActionResult<{ status: QuestionStatus }>> {
  return runAction(async () => {
    await requireAdmin();
    return regenerateRecord(createServiceSupabase(), getAiClient(), id, expectedVersion);
  });
}

/** Students and admins alike. */
export async function flagQuestion(id: string, comment: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireUser();
    await flagRecord(createServiceSupabase(), { id: user.id, role: user.role }, id, comment);
  });
}
