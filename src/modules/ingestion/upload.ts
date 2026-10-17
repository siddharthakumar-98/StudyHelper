"use server";

// Only the server ever runs this file (the client gets action references), and it
// uses the service-role client.
import "server-only";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { runAction, type ActionResult } from "@/modules/bank/actionResult";
import {
  createUploadRecords,
  finalizeUploadRecords,
  type UploadInput,
  type UploadTicket,
} from "./uploadService";
import {
  latestJobOf,
  latestJobsOf,
  pageViewUrlFor,
  startQuestionWritingRecord,
  updateSlideTextRecord,
  type LatestJob,
} from "./slideService";

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

/**
 * Saves a slide correction; questions that cite the slide go back to the admin
 * (R38). `questionsSentToReview` says how many.
 */
export async function updateSlideText(
  slideId: string,
  verbatimText: string,
): Promise<ActionResult<{ questionsSentToReview: number }>> {
  return runAction(async () => {
    await requireAdmin();
    return updateSlideTextRecord(createServiceSupabase(), slideId, verbatimText);
  });
}

/** "Write questions": starts topic_map once the slides have been checked (R38). */
export async function startQuestionWriting(documentId: string): Promise<ActionResult<{ jobId: string }>> {
  return runAction(async () => {
    await requireAdmin();
    return startQuestionWritingRecord(createServiceSupabase(), documentId);
  });
}

export async function getPageViewUrl(pageId: string): Promise<string> {
  await requireUser();
  return pageViewUrlFor(createServiceSupabase(), pageId);
}

export async function getLatestJob(documentId: string): Promise<LatestJob | null> {
  await requireUser();
  return latestJobOf(createServiceSupabase(), documentId);
}

/** The newest job of each handout, for the stage labels of the Materials list. */
export async function getLatestJobs(documentIds: string[]): Promise<Map<string, LatestJob>> {
  await requireUser();
  return latestJobsOf(createServiceSupabase(), documentIds);
}
