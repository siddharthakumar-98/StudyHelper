import Link from "next/link";
import type { BankListItem } from "@/modules/bank/repository";
import { StatusBadge } from "./StatusBadge";
import { DIFFICULTY_LABEL, TYPE_LABEL } from "./bankView";

const pill = "rounded-full border-2 border-zinc-600 bg-white px-3 py-1 text-base font-semibold text-zinc-900";

/** One row of the bank list: only what a student may see (no key, no review notes). */
export function QuestionCard({ question }: { question: BankListItem }) {
  return (
    <li>
      <Link
        href={`/bank/${question.id}`}
        className="tap flex flex-col gap-2 rounded-xl border-2 border-zinc-300 p-4 hover:bg-zinc-50"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={pill}>{TYPE_LABEL[question.type]}</span>
          <span className={pill}>{DIFFICULTY_LABEL[question.difficulty]}</span>
          <StatusBadge status={question.status} />
          {question.hasConflictNote ? (
            <span className="inline-flex items-center gap-1 rounded-full border-2 border-amber-800 bg-amber-100 px-3 py-1 text-base font-semibold text-amber-950">
              <span aria-hidden="true">⚠</span>
              <span>Course vs guideline note</span>
            </span>
          ) : null}
        </span>
        <span className="text-base font-semibold text-zinc-700">{question.topicName}</span>
        <span className="line-clamp-2 break-words text-lg font-bold text-blue-900">{question.stem}</span>
        {question.sourceLabel ? (
          <span className="text-base text-zinc-800">Source: {question.sourceLabel}</span>
        ) : null}
      </Link>
    </li>
  );
}
