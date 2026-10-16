"use server";

import { requireAdmin, requireUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getAiClient } from "@/modules/ai/usage";
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

export async function approveQuestion(id: string): Promise<void> {
  await requireAdmin();
  await approveRecord(createServiceSupabase(), id);
}

export async function rejectQuestion(id: string, reason: string): Promise<void> {
  await requireAdmin();
  await rejectRecord(createServiceSupabase(), id, reason);
}

export async function editQuestion(id: string, edit: QuestionEdit): Promise<{ version: number }> {
  await requireAdmin();
  return editRecord(createServiceSupabase(), id, edit);
}

/** Writes and checks a replacement (up to three AI calls); the page that uses it sets maxDuration = 300. */
export async function regenerateQuestion(id: string): Promise<{ status: QuestionStatus }> {
  await requireAdmin();
  return regenerateRecord(createServiceSupabase(), getAiClient(), id);
}

/** Students and admins alike. */
export async function flagQuestion(id: string, comment: string | null): Promise<void> {
  const user = await requireUser();
  await flagRecord(createServiceSupabase(), { id: user.id, role: user.role }, id, comment);
}
