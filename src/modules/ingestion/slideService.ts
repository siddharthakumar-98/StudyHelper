import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { MATERIALS_BUCKET } from "./paths";

// Database work behind the slide-review server actions (see upload.ts for why it
// lives outside the "use server" file).

export const MAX_SLIDE_TEXT_LENGTH = 20_000;
export const VIEW_URL_SECONDS = 600;

/** Saves an admin's correction. Re-extraction leaves corrected slides alone. */
export async function updateSlideTextRecord(
  db: SupabaseClient<Database>,
  slideId: string,
  verbatimText: unknown,
): Promise<void> {
  if (typeof verbatimText !== "string") throw new Error("The slide text must be text");
  if (verbatimText.length > MAX_SLIDE_TEXT_LENGTH) {
    throw new Error(`The slide text is too long (up to ${MAX_SLIDE_TEXT_LENGTH} characters)`);
  }
  const { data, error } = await db
    .from("source_slides")
    .update({ verbatim_text: verbatimText, admin_corrected: true })
    .eq("id", slideId)
    .select("id");
  if (error) throw new Error(`Could not save the correction: ${error.message}`);
  if (data.length === 0) throw new Error("Slide not found");
}

/** A short-lived link to the stored page (photo or PDF page). */
export async function pageViewUrlFor(
  db: SupabaseClient<Database>,
  pageId: string,
): Promise<string> {
  const { data: page, error } = await db
    .from("source_pages")
    .select("storage_path")
    .eq("id", pageId)
    .maybeSingle();
  if (error) throw new Error(`Could not find the page: ${error.message}`);
  if (!page) throw new Error("Page not found");
  const { data, error: urlError } = await db.storage
    .from(MATERIALS_BUCKET)
    .createSignedUrl(page.storage_path, VIEW_URL_SECONDS);
  if (urlError) throw new Error(`Could not open the photo: ${urlError.message}`);
  return data.signedUrl;
}

export type LatestJob = {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "failed";
};

/** The newest job of a handout, whatever its status (null when it has none). */
export async function latestJobOf(
  db: SupabaseClient<Database>,
  documentId: string,
): Promise<LatestJob | null> {
  const { data, error } = await db
    .from("jobs")
    .select("id, kind, status")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not look up the job: ${error.message}`);
  return data[0] ?? null;
}
