import Link from "next/link";
import { notFound } from "next/navigation";
import { QuestionDetailView, type DetailSource } from "@/components/bank/QuestionDetailView";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { BankError } from "@/modules/bank/errors";
import { getQuestionDetail } from "@/modules/bank/repository";

// "Write a new version" (regenerateQuestion) runs up to three AI calls from this page.
export const maxDuration = 300;

export default async function QuestionPage({ params }: { params: Promise<{ questionId: string }> }) {
  const user = await requireUser();
  const { questionId } = await params;

  let detail;
  try {
    detail = await getQuestionDetail(questionId);
  } catch (error) {
    if (error instanceof BankError) notFound();
    throw error;
  }

  // "View slide" needs the page each cited slide sits on (read as the signed-in user).
  const supabase = await createServerSupabase();
  const slideIds = detail.sourceRefs.map((ref) => ref.slideId);
  const pages = new Map<string, string>();
  if (slideIds.length > 0) {
    const { data, error } = await supabase.from("source_slides").select("id, page_id").in("id", slideIds);
    if (error) throw new Error(`Could not load the source slides: ${error.message}`);
    for (const row of data) pages.set(row.id, row.page_id);
  }
  const sources: DetailSource[] = detail.sourceRefs.map((ref) => ({
    label: ref.label,
    pageId: pages.get(ref.slideId) ?? null,
  }));

  return (
    <>
      <Link
        href="/bank"
        className="tap mb-4 inline-flex items-center gap-2 text-lg font-semibold text-blue-900 underline"
      >
        <span aria-hidden="true">←</span>
        <span>All questions</span>
      </Link>
      <QuestionDetailView detail={detail} sources={sources} isAdmin={user.role === "admin"} />
    </>
  );
}
