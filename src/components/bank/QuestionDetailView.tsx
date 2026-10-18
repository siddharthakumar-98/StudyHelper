import type { QuestionDetail } from "@/modules/bank/repository";
import { AdminActions } from "./AdminActions";
import { FlagDialog } from "./FlagDialog";
import { StatusBadge } from "./StatusBadge";
import { ViewSlideButton } from "./ViewSlideButton";
import { DIFFICULTY_LABEL, TYPE_LABEL } from "./bankView";
import { mcqFormFrom, saqFormFrom } from "./editQuestion";

export type DetailSource = { label: string; pageId: string | null };

const pill = "rounded-full border-2 border-zinc-600 bg-white px-3 py-1 text-base font-semibold text-zinc-900";

function money(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * A server component. A student's page has the stem, options (no correct mark), the source,
 * any conflict note and the flag button. Everything below `isAdmin` (the answer key, review
 * notes, flags, versions and the review tools) is rendered only for an admin: the key is
 * null for a student, and this component never asks a student's browser to fetch it.
 */
export function QuestionDetailView({
  detail,
  sources,
  isAdmin,
}: {
  detail: QuestionDetail;
  sources: DetailSource[];
  isAdmin: boolean;
}) {
  const key = isAdmin ? detail.key : null;
  const letter = (id: string) => id.toUpperCase();
  const form =
    key && detail.type === "mcq"
      ? {
          kind: "mcq" as const,
          value: mcqFormFrom({
            stem: detail.stem,
            difficulty: detail.difficulty,
            options: detail.options,
            key,
          }),
        }
      : key && detail.type === "saq"
        ? {
            kind: "saq" as const,
            value: saqFormFrom({ stem: detail.stem, difficulty: detail.difficulty, key }),
          }
        : null;

  return (
    <article aria-labelledby="question-heading" className="max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className={pill}>{TYPE_LABEL[detail.type]}</span>
        <span className={pill}>{DIFFICULTY_LABEL[detail.difficulty]}</span>
        <StatusBadge status={detail.status} />
        <span className="text-base font-semibold text-zinc-700">{detail.topicName}</span>
      </div>

      <h1 id="question-heading" className="mt-4 text-3xl font-bold">
        Question
      </h1>
      <p className="mt-3 whitespace-pre-wrap break-words text-xl">{detail.stem}</p>

      {detail.options ? (
        <ol aria-label="Answer options" className="mt-5 grid gap-3">
          {detail.options.map((option) => {
            const correct = key?.correctOptionId === option.id;
            return (
              <li
                key={option.id}
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border-2 p-3 text-lg ${
                  correct ? "border-green-800 bg-green-50" : "border-zinc-300"
                }`}
              >
                <span className="font-bold">{letter(option.id)}.</span>
                <span className="min-w-0 break-words">{option.text}</span>
                {correct ? (
                  <span className="inline-flex items-center gap-1 font-bold text-green-950">
                    <span aria-hidden="true">✓</span>
                    <span>Correct answer</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {detail.conflictNote?.trim() ? (
        <aside
          role="note"
          aria-label="Course vs guideline note"
          className="mt-6 rounded-lg border-2 border-amber-800 bg-amber-100 p-4 text-amber-950"
        >
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden="true">⚠</span>
            Course vs guideline note
          </h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-lg">{detail.conflictNote}</p>
        </aside>
      ) : null}

      {sources.length > 0 ? (
        <section aria-label="Source" className="mt-6">
          <h2 className="text-xl font-bold">Source</h2>
          <ul className="mt-2 grid gap-2">
            {sources.map((source) => (
              <li key={source.label} className="flex flex-wrap items-center gap-3 text-lg">
                <span className="font-semibold">{source.label}</span>
                {source.pageId ? <ViewSlideButton pageId={source.pageId} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.status === "active" || detail.status === "flagged" ? (
        <div className="mt-6">
          <FlagDialog questionId={detail.id} flagged={detail.status === "flagged"} />
        </div>
      ) : null}

      {isAdmin ? (
        <>
          {key ? (
            <section aria-label="Answer key" className="mt-8 border-t-2 border-zinc-300 pt-6">
              <h2 className="text-2xl font-bold">Answer key</h2>
              {key.explanation ? (
                <div className="mt-3">
                  <h3 className="text-lg font-bold">Explanation</h3>
                  <p className="whitespace-pre-wrap break-words text-lg">{key.explanation}</p>
                </div>
              ) : null}
              {key.modelAnswer ? (
                <div className="mt-3">
                  <h3 className="text-lg font-bold">Model answer</h3>
                  <p className="whitespace-pre-wrap break-words text-lg">{key.modelAnswer}</p>
                </div>
              ) : null}
              {key.keyConcepts && key.keyConcepts.length > 0 ? (
                <div className="mt-3">
                  <h3 className="text-lg font-bold">Key concepts</h3>
                  <ul className="list-disc pl-6 text-lg">
                    {key.keyConcepts.map((k) => (
                      <li key={k.concept}>
                        {k.concept}
                        {k.equivalents.length > 0 ? (
                          <span className="text-zinc-700"> (also: {k.equivalents.join(", ")})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {key.rubric ? (
                <div className="mt-3">
                  <h3 className="text-lg font-bold">Marking rubric</h3>
                  <div className="overflow-x-auto">
                    <table className="mt-1 w-full border-collapse text-lg">
                      <thead>
                        <tr>
                          <th scope="col" className="border border-zinc-400 bg-zinc-100 px-3 py-2 text-left">
                            Criterion
                          </th>
                          <th scope="col" className="border border-zinc-400 bg-zinc-100 px-3 py-2 text-left">
                            Weight
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {key.rubric.criteria.map((c) => (
                          <tr key={c.id}>
                            <td className="border border-zinc-400 px-3 py-2">{c.statement}</td>
                            <td className="border border-zinc-400 px-3 py-2">{money(c.weight)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {key.rubric.critical_errors.length > 0 ? (
                    <div className="mt-3">
                      <h4 className="text-lg font-bold">Critical errors</h4>
                      <ul className="list-disc pl-6 text-lg">
                        {key.rubric.critical_errors.map((e) => (
                          <li key={e.id}>{e.statement}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {detail.reviewNotes.length > 0 ? (
            <section aria-label="Review notes" className="mt-6">
              <h2 className="text-xl font-bold">Review notes</h2>
              <ul className="mt-1 list-disc pl-6 text-lg">
                {detail.reviewNotes.map((note, i) => (
                  <li key={i} className="break-words">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="Flags" className="mt-6">
            <h2 className="text-xl font-bold">Flags</h2>
            {detail.flags.length === 0 ? (
              <p className="mt-1 text-lg">No open flags.</p>
            ) : (
              <ul className="mt-1 grid gap-2">
                {detail.flags.map((flag, i) => (
                  <li key={i} className="rounded-lg bg-zinc-100 p-3 text-lg">
                    <span className="break-words">{flag.comment ?? "(no comment)"}</span>
                    <span className="block text-base text-zinc-700">
                      {new Date(flag.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 text-lg">
            Version {detail.version} · {detail.versionCount}{" "}
            {detail.versionCount === 1 ? "version" : "versions"} in total
          </p>

          <AdminActions
            id={detail.id}
            status={detail.status}
            version={detail.version}
            type={detail.type}
            form={form}
          />
        </>
      ) : null}
    </article>
  );
}
