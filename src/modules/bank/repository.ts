import "server-only";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  listQuestionsFor,
  questionDetailFor,
  type BankFilter,
  type BankListItem,
  type QuestionDetail,
} from "./bankService";

// Server data loaders for the Question Bank pages. Not "use server": they cannot
// be called from the browser, only imported by server components. Each checks
// the session itself (the (app) layout does not re-run on soft navigation).

export type {
  AnswerKeyView,
  BankFilter,
  BankListItem,
  QuestionDetail,
  QuestionEdit,
  SourceRef,
} from "./bankService";

/** Runs as the signed-in user, so students only ever see active and flagged questions. */
export async function listQuestions(filter: BankFilter): Promise<BankListItem[]> {
  await requireUser();
  return listQuestionsFor(await createServerSupabase(), filter);
}

/**
 * A student gets the question without its key. An admin also gets the key,
 * review notes and conflict note, read with the service client (which this
 * branch alone reaches, after the session says admin).
 */
export async function getQuestionDetail(id: string): Promise<QuestionDetail> {
  const user = await requireUser();
  return questionDetailFor(
    await createServerSupabase(),
    id,
    user.role === "admin" ? createServiceSupabase() : undefined,
  );
}
