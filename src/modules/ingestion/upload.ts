"use server";

import { requireAdmin, requireUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  createUploadRecords,
  finalizeUploadRecords,
  type UploadInput,
  type UploadTicket,
} from "./uploadService";
import { latestUnfinishedJobId, pageViewUrlFor, updateSlideTextRecord } from "./slideService";

export async function createUpload(
  input: UploadInput,
): Promise<{ documentId: string; uploads: UploadTicket[] }> {
  const user = await requireAdmin();
  return createUploadRecords(createServiceSupabase(), user.id, input);
}

export async function finalizeUpload(documentId: string): Promise<{ jobId: string }> {
  await requireAdmin();
  return finalizeUploadRecords(createServiceSupabase(), documentId);
}

export async function updateSlideText(slideId: string, verbatimText: string): Promise<void> {
  await requireAdmin();
  await updateSlideTextRecord(createServiceSupabase(), slideId, verbatimText);
}

export async function getPageViewUrl(pageId: string): Promise<string> {
  await requireUser();
  return pageViewUrlFor(createServiceSupabase(), pageId);
}

export async function getLatestJobId(documentId: string): Promise<string | null> {
  await requireUser();
  return latestUnfinishedJobId(createServiceSupabase(), documentId);
}
