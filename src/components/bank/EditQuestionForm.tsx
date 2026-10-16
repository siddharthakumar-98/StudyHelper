"use client";

import { useState } from "react";
import type { ActionResult } from "@/modules/bank/actionResult";
import { DIFFICULTY_CHIPS, GENERIC_ERROR, STALE_COPY, isStaleError, type Difficulty } from "./bankView";
import {
  buildQuestionEdit,
  type EditPayload,
  type McqForm,
  type SaqForm,
} from "./editQuestion";

type Props = {
  type: "mcq" | "saq";
  initial: McqForm | SaqForm;
  /** True while any admin action is running: every button stays disabled. */
  pending: boolean;
  /** True while this form's own save is running. */
  saving: boolean;
  onSave: (edit: EditPayload) => Promise<ActionResult<{ version: number }> | null>;
  onCancel: () => void;
  onReload: () => void;
};

const field = "w-full rounded-lg border border-zinc-500 bg-white p-3 text-lg text-zinc-950";
const label = "block text-lg font-semibold";
const OPTION_LABEL: Record<string, string> = { a: "Option A", b: "Option B", c: "Option C", d: "Option D" };

/** Edits the current version; every problem the checks find is listed inline. */
export function EditQuestionForm({ type, initial, pending, saving, onSave, onCancel, onReload }: Props) {
  const [form, setForm] = useState<McqForm | SaqForm>(initial);
  const [issues, setIssues] = useState<string[]>([]);
  const [stale, setStale] = useState(false);

  const mcq = type === "mcq" ? (form as McqForm) : null;
  const saq = type === "saq" ? (form as SaqForm) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setIssues([]);
    setStale(false);
    const built = buildQuestionEdit(type, form);
    if (!built.ok) {
      setIssues(built.issues);
      return;
    }
    try {
      const result = await onSave(built.edit);
      if (!result || result.ok) return;
      if (isStaleError(result.error)) setStale(true);
      else setIssues(result.issues?.length ? result.issues : [result.error]);
    } catch {
      setIssues([GENERIC_ERROR]);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label="Edit question"
      className="mt-4 flex max-w-3xl flex-col gap-5 rounded-xl border-2 border-zinc-400 p-4"
    >
      <h3 className="text-xl font-bold">Edit this question</h3>
      <div>
        <label htmlFor="edit-stem" className={label}>
          Question text
        </label>
        <textarea
          id="edit-stem"
          rows={4}
          value={form.stem}
          onChange={(e) => setForm({ ...form, stem: e.target.value })}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="edit-difficulty" className={label}>
          Difficulty
        </label>
        <select
          id="edit-difficulty"
          value={form.difficulty}
          onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
          className="tap min-h-12 w-full max-w-xs rounded-lg border border-zinc-500 bg-white px-3 text-lg text-zinc-950"
        >
          {DIFFICULTY_CHIPS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {mcq ? (
        <>
          {mcq.options.map((option, i) => (
            <div key={option.id}>
              <label htmlFor={`edit-option-${option.id}`} className={label}>
                {OPTION_LABEL[option.id]}
              </label>
              <input
                id={`edit-option-${option.id}`}
                type="text"
                value={option.text}
                onChange={(e) =>
                  setForm({
                    ...mcq,
                    options: mcq.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)),
                  })
                }
                className={`${field} min-h-12`}
              />
            </div>
          ))}
          <fieldset>
            <legend className={label}>Which option is correct?</legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {mcq.options.map((option) => (
                <label key={option.id} className="tap flex items-center gap-2 text-lg">
                  <input
                    type="radio"
                    name="correct-option"
                    value={option.id}
                    checked={mcq.correctOptionId === option.id}
                    onChange={() => setForm({ ...mcq, correctOptionId: option.id })}
                    className="size-6"
                  />
                  {option.id.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="edit-why" className={label}>
              Why it is correct
            </label>
            <textarea
              id="edit-why"
              rows={3}
              value={mcq.explanation}
              onChange={(e) => setForm({ ...mcq, explanation: e.target.value })}
              className={field}
            />
          </div>
        </>
      ) : null}

      {saq ? (
        <>
          <div>
            <label htmlFor="edit-model" className={label}>
              Model answer
            </label>
            <textarea
              id="edit-model"
              rows={6}
              value={saq.modelAnswer}
              onChange={(e) => setForm({ ...saq, modelAnswer: e.target.value })}
              className={field}
            />
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className={label}>Key concepts</legend>
            {saq.keyConcepts.map((k, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={`edit-concept-${i}`} className="block text-base font-semibold">
                    Concept {i + 1}
                  </label>
                  <input
                    id={`edit-concept-${i}`}
                    type="text"
                    value={k.concept}
                    onChange={(e) =>
                      setForm({
                        ...saq,
                        keyConcepts: saq.keyConcepts.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)),
                      })
                    }
                    className={`${field} min-h-12`}
                  />
                </div>
                <div>
                  <label htmlFor={`edit-concept-words-${i}`} className="block text-base font-semibold">
                    Other wordings for concept {i + 1} (separate with commas)
                  </label>
                  <input
                    id={`edit-concept-words-${i}`}
                    type="text"
                    value={k.equivalents}
                    onChange={(e) =>
                      setForm({
                        ...saq,
                        keyConcepts: saq.keyConcepts.map((x, j) =>
                          j === i ? { ...x, equivalents: e.target.value } : x,
                        ),
                      })
                    }
                    className={`${field} min-h-12`}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className={label}>Marking rubric (weights add up to 5)</legend>
            {saq.criteria.map((c, i) => (
              <div key={c.id} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                <div>
                  <label htmlFor={`edit-criterion-${c.id}`} className="block text-base font-semibold">
                    Criterion {i + 1}
                  </label>
                  <input
                    id={`edit-criterion-${c.id}`}
                    type="text"
                    value={c.statement}
                    onChange={(e) =>
                      setForm({
                        ...saq,
                        criteria: saq.criteria.map((x, j) => (j === i ? { ...x, statement: e.target.value } : x)),
                      })
                    }
                    className={`${field} min-h-12`}
                  />
                </div>
                <div>
                  <label htmlFor={`edit-weight-${c.id}`} className="block text-base font-semibold">
                    Weight {i + 1}
                  </label>
                  <input
                    id={`edit-weight-${c.id}`}
                    type="text"
                    inputMode="decimal"
                    value={c.weight}
                    onChange={(e) =>
                      setForm({
                        ...saq,
                        criteria: saq.criteria.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)),
                      })
                    }
                    className={`${field} min-h-12`}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          {saq.criticalErrors.length > 0 ? (
            <fieldset className="flex flex-col gap-3">
              <legend className={label}>Critical errors</legend>
              {saq.criticalErrors.map((e, i) => (
                <div key={e.id}>
                  <label htmlFor={`edit-error-${e.id}`} className="block text-base font-semibold">
                    Critical error {i + 1}
                  </label>
                  <input
                    id={`edit-error-${e.id}`}
                    type="text"
                    value={e.statement}
                    onChange={(ev) =>
                      setForm({
                        ...saq,
                        criticalErrors: saq.criticalErrors.map((x, j) =>
                          j === i ? { ...x, statement: ev.target.value } : x,
                        ),
                      })
                    }
                    className={`${field} min-h-12`}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
        </>
      ) : null}

      {issues.length > 0 ? (
        <div role="alert" className="rounded-lg border-2 border-red-800 bg-red-50 p-3 text-red-900">
          <p className="font-bold">Please fix this before saving:</p>
          <ul className="mt-1 list-disc pl-6">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {stale ? (
        <div role="alert" className="rounded-lg border-2 border-amber-800 bg-amber-50 p-3 text-amber-950">
          <p className="font-bold">{STALE_COPY}</p>
          <button
            type="button"
            onClick={onReload}
            className="tap mt-2 rounded-lg border-2 border-amber-900 px-5 text-lg font-bold hover:bg-amber-100"
          >
            Reload
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="tap rounded-lg bg-blue-900 px-6 text-lg font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="tap rounded-lg border-2 border-zinc-700 px-6 text-lg font-bold text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
