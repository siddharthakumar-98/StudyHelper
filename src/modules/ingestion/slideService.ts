import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { BankError } from "@/modules/bank/errors";
import { transition } from "@/modules/bank/lifecycle";
import { MATERIALS_BUCKET } from "./paths";

// Database work behind the slide-review server actions (see upload.ts for why it
// lives outside the "use server" file).

export const MAX_SLIDE_TEXT_LENGTH = 20_000;
export const VIEW_URL_SECONDS = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The review note a question gets when a slide it cites is corrected (R38). */
export const SOURCE_CORRECTED_NOTE = "Source slide was corrected";

/**
 * Saves an admin's correction (re-extraction leaves corrected slides alone), then
 * sends every question whose current version cites the slide back to the admin
 * (R38), through the lifecycle and the set_question_status check-and-set: active
 * questions move to needs_review, and those already needing review or flagged keep
 * their status; each gets the note "Source slide was corrected". Drafts are left
 * to the verify stage, which reads the corrected text, and retired questions stay
 * retired. Returns how many questions now wait for the admin because of this.
 */
export async function updateSlideTextRecord(
  db: SupabaseClient<Database>,
  slideId: string,
  verbatimText: unknown,
): Promise<{ questionsSentToReview: number }> {
  if (typeof verbatimText !== "string") throw new BankError("The slide text must be text");
  if (verbatimText.length > MAX_SLIDE_TEXT_LENGTH) {
    throw new BankError(`The slide text is too long (up to ${MAX_SLIDE_TEXT_LENGTH} characters)`);
  }
  if (!UUID.test(slideId)) throw new BankError("Slide not found");
  const { data, error } = await db
    .from("source_slides")
    .update({ verbatim_text: verbatimText, admin_corrected: true })
    .eq("id", slideId)
    .select("id");
  if (error) throw new Error(`Could not save the correction: ${error.message}`);
  if (data.length === 0) throw new BankError("Slide not found");

  const { data: citing, error: citingError } = await db
    .from("questions")
    .select("id, status, current_version, question_versions!inner(version, source_refs)")
    .in("status", ["active", "needs_review", "flagged"])
    // A JSON string: an array value would be sent as a Postgres array literal.
    .contains("question_versions.source_refs", JSON.stringify([{ slideId }]));
  if (citingError) throw new Error(`Could not find the questions that use this slide: ${citingError.message}`);

  let sent = 0;
  for (const q of citing) {
    // Only the current version counts: an older one may have cited the slide.
    if (!q.question_versions.some((v) => v.version === q.current_version)) continue;
    const { to } = transition(q.status, "source_corrected", "system");
    const { data: moved, error: moveError } = await db.rpc("set_question_status", {
      p_question_id: q.id,
      p_from: q.status,
      p_to: to,
      p_note: SOURCE_CORRECTED_NOTE,
    });
    if (moveError) throw new Error(`Could not send a question for review: ${moveError.message}`);
    // False: the question changed meanwhile (an admin acted on it); leave it.
    if (moved) sent += 1;
  }
  return { questionsSentToReview: sent };
}

/**
 * "Write questions" (R38): starts topic_map for a handout whose slides are
 * waiting for the admin's check, and moves it to processing. Safe to repeat: an
 * unfinished topic_map job is returned instead of adding another
 * (start_question_writing). A handout that is not waiting gets a BankError.
 */
export async function startQuestionWritingRecord(
  db: SupabaseClient<Database>,
  documentId: string,
): Promise<{ jobId: string }> {
  if (!UUID.test(documentId)) throw new BankError("Handout not found");
  const { data, error } = await db.rpc("start_question_writing", { p_document_id: documentId });
  if (error) throw new Error(`Could not start writing questions: ${error.message}`);
  if (!data) {
    throw new BankError("This handout is not waiting for its slides to be checked. Reload the page.");
  }
  return { jobId: data };
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
