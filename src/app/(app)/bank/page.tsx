import { BankFilters } from "@/components/bank/BankFilters";
import { QuestionCard } from "@/components/bank/QuestionCard";
import {
  STATUS_LABEL,
  countLabel,
  defaultStatus,
  parseBankSearch,
} from "@/components/bank/bankView";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { listQuestions } from "@/modules/bank/repository";

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const search = parseBankSearch(await searchParams, isAdmin);

  // An admin opens on the review queue while it has questions in it.
  const status =
    search.status ??
    defaultStatus(isAdmin, isAdmin ? (await listQuestions({ status: "needs_review" })).length : 0);

  const supabase = await createServerSupabase();
  const [questions, topicsResult] = await Promise.all([
    listQuestions({
      status,
      type: search.type,
      difficulty: search.difficulty,
      topicId: search.topicId,
    }),
    supabase.from("topics").select("id, name").order("name"),
  ]);
  if (topicsResult.error) throw new Error(`Could not load topics: ${topicsResult.error.message}`);

  return (
    <>
      <h1 className="text-3xl font-bold">Question Bank</h1>
      <div className="max-w-3xl">
        <BankFilters
          search={{ ...search, status }}
          isAdmin={isAdmin}
          topics={topicsResult.data}
        />
        <p role="status" className="mt-6 text-xl font-bold">
          {countLabel(questions.length)}
        </p>
        {questions.length === 0 ? (
          <p className="mt-3 text-lg">
            {status === "needs_review"
              ? "Nothing is waiting for review."
              : `No ${STATUS_LABEL[status].toLowerCase()} questions match these filters.`}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {questions.map((question) => (
              <QuestionCard key={question.id} question={question} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
