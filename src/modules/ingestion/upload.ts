"use server";

import { requireAdmin } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  createUploadRecords,
  finalizeUploadRecords,
  type UploadInput,
  type UploadTicket,
} from "./uploadService";

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
