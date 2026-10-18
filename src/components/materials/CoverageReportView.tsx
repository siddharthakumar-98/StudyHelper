import type { CoverageReport } from "@/modules/generation/coverage";

const REASON_COPY: Record<CoverageReport["slidesWithoutQuestions"][number]["reason"], string> = {
  unreadable: "The text could not be read",
  "not in any topic": "Not in any topic",
  "could not be processed automatically": "Could not be processed automatically",
  "no question generated": "No question could be written from it",
};

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const cell = "px-3 py-2 text-right tabular-nums";
const head = "px-3 py-2 text-right font-bold";

export function CoverageReportView({ report }: { report: CoverageReport }) {
  const { totals, perTopic, slidesWithoutQuestions, shortfallNote } = report;
  const active = totals.activeMcq + totals.activeSaq;

  return (
    <section aria-label="Coverage report" className="mt-10">
      <h2 className="text-2xl font-bold">Coverage report</h2>
      <p className="mt-2 text-lg">
        <strong>{active} active questions</strong> ({totals.activeMcq} multiple choice,{" "}
        {totals.activeSaq} short answer)
      </p>
      <p className="text-lg text-zinc-800">
        {totals.needsReview} need review · {totals.retired} retired
      </p>

      {shortfallNote ? (
        <p
          role="note"
          className="mt-4 max-w-2xl rounded-lg border-2 border-amber-700 bg-amber-100 p-4 text-lg text-amber-950"
        >
          {shortfallNote}
        </p>
      ) : null}

      {perTopic.length > 0 ? (
        <div className="mt-6 max-w-full overflow-x-auto">
          <table className="min-w-full border-collapse text-lg">
            <caption className="pb-2 text-left text-xl font-bold">
              Active questions by topic
            </caption>
            <thead>
              <tr className="border-b-2 border-zinc-400">
                <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-bold">
                  Topic
                </th>
                <th scope="col" rowSpan={2} className={head}>
                  Slides
                </th>
                <th scope="colgroup" colSpan={3} className="px-3 py-2 text-center font-bold">
                  Multiple choice
                </th>
                <th scope="colgroup" colSpan={3} className="px-3 py-2 text-center font-bold">
                  Short answer
                </th>
              </tr>
              <tr className="border-b-2 border-zinc-400">
                {["mcq", "saq"].flatMap((kind) =>
                  DIFFICULTIES.map((d) => (
                    <th key={`${kind}-${d}`} scope="col" className={`${head} capitalize`}>
                      {d}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {perTopic.map((t) => (
                <tr key={t.topicId} className="border-b border-zinc-300">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    {t.name}
                  </th>
                  <td className={cell}>{t.slideCount}</td>
                  {DIFFICULTIES.map((d) => (
                    <td key={`mcq-${d}`} className={cell}>
                      {t.mcq[d]}
                    </td>
                  ))}
                  {DIFFICULTIES.map((d) => (
                    <td key={`saq-${d}`} className={cell}>
                      {t.saq[d]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-lg">No topics were found in this handout.</p>
      )}

      <h3 className="mt-8 text-xl font-bold">Slides without questions</h3>
      {slidesWithoutQuestions.length === 0 ? (
        <p className="mt-2 text-lg">Every slide has at least one question.</p>
      ) : (
        <ul aria-label="Slides without questions" className="mt-2 grid max-w-2xl gap-2">
          {slidesWithoutQuestions.map((s) => (
            <li
              key={s.slideId}
              className="flex flex-wrap items-center justify-between gap-x-4 rounded-lg bg-zinc-100 px-4 py-3 text-lg"
            >
              <span className="font-semibold">{s.label}</span>
              <span>{REASON_COPY[s.reason]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
