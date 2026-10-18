import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createJob } from "@/modules/jobs/engine";
import { SupabaseJobStore } from "@/modules/jobs/store";
import { MATERIALS_BUCKET, originalDir, originalPath } from "./paths";
import {
  ACCEPTED_TYPES,
  validateUploadFiles,
  type UploadFileInfo,
} from "./validateUpload";

// Database work behind the upload server actions. Kept out of the "use server"
// file because every export of that file becomes callable from the browser.

export type UploadInput = {
  title: string;
  classDate: string | null;
  files: UploadFileInfo[];
};

export type UploadTicket = { fileIndex: number; path: string; token: string };

const MAX_FILES = 40;

export async function createUploadRecords(
  db: SupabaseClient<Database>,
  userId: string,
  input: UploadInput,
): Promise<{ documentId: string; uploads: UploadTicket[] }> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) throw new Error("Enter a title (up to 200 characters)");
  if (input.classDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.classDate)) {
    throw new Error("Class date is not valid");
  }
  if (input.files.length > MAX_FILES) throw new Error(`Add at most ${MAX_FILES} files at a time`);
  const problems = validateUploadFiles(input.files);
  if (problems.length > 0) throw new Error(problems.join(". "));
  // HEIC is converted to JPEG in the browser; only these types may reach storage.
  const unconverted = input.files.find(
    (f) => !(ACCEPTED_TYPES as readonly string[]).includes(f.type),
  );
  if (unconverted) throw new Error(`${unconverted.name}: only PDF, JPG or PNG files can be uploaded`);

  const { data: doc, error: docError } = await db
    .from("documents")
    .insert({ title, class_date: input.classDate, uploaded_by: userId })
    .select("id")
    .single();
  if (docError) throw new Error(`Could not create the handout: ${docError.message}`);

  const fileRows = input.files.map((file, fileIndex) => ({
    document_id: doc.id,
    file_index: fileIndex,
    storage_path: originalPath(doc.id, fileIndex, file.name),
    mime_type: file.type,
    size_bytes: file.size,
  }));
  const { error: filesError } = await db.from("document_files").insert(fileRows);
  if (filesError) throw new Error(`Could not record the files: ${filesError.message}`);

  const uploads: UploadTicket[] = [];
  for (const row of fileRows) {
    const { data, error } = await db.storage
      .from(MATERIALS_BUCKET)
      .createSignedUploadUrl(row.storage_path);
    if (error) throw new Error(`Could not prepare the upload: ${error.message}`);
    uploads.push({ fileIndex: row.file_index, path: data.path, token: data.token });
  }
  return { documentId: doc.id, uploads };
}

async function findSplitJob(db: SupabaseClient<Database>, documentId: string): Promise<string | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id")
    .eq("document_id", documentId)
    .eq("kind", "split")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look up the job: ${error.message}`);
  return data[0]?.id ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Confirms every file reached storage, then starts the split job (once per handout). */
export async function finalizeUploadRecords(
  db: SupabaseClient<Database>,
  documentId: string,
): Promise<{ jobId: string }> {
  const existing = await findSplitJob(db, documentId);
  if (existing) return { jobId: existing };

  const { data: doc, error: docError } = await db
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .maybeSingle();
  if (docError) throw new Error(`Could not read the handout: ${docError.message}`);
  if (!doc) throw new Error("Handout not found");

  const { data: files, error: filesError } = await db
    .from("document_files")
    .select("storage_path")
    .eq("document_id", documentId);
  if (filesError) throw new Error(`Could not read the files: ${filesError.message}`);
  if (files.length === 0) throw new Error("This handout has no files");

  const { data: objects, error: listError } = await db.storage
    .from(MATERIALS_BUCKET)
    .list(originalDir(documentId), { limit: 1000 });
  if (listError) throw new Error(`Could not check the uploads: ${listError.message}`);
  const present = new Set(objects.map((o) => `${originalDir(documentId)}/${o.name}`));
  const missing = files.filter((f) => !present.has(f.storage_path));
  if (missing.length > 0) {
    throw new Error(`${missing.length} file(s) did not finish uploading. Please try again.`);
  }

  // Only the caller that flips the status creates the job.
  const { data: won, error: gateError } = await db
    .from("documents")
    .update({ status: "splitting" })
    .eq("id", documentId)
    .eq("status", "uploading")
    .select("id");
  if (gateError) throw new Error(`Could not start processing: ${gateError.message}`);

  if (won.length === 0) {
    // Another call is starting (or has started) the job; wait briefly for it.
    for (let i = 0; i < 10; i++) {
      const jobId = await findSplitJob(db, documentId);
      if (jobId) return { jobId };
      await sleep(300);
    }
  }
  const jobId = await createJob(new SupabaseJobStore(db), "split", documentId, {});
  return { jobId };
}
