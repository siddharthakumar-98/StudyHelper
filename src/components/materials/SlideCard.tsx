"use client";

import { useState } from "react";
import { getPageViewUrl, updateSlideText } from "@/modules/ingestion/upload";
import { slideHeading } from "@/modules/ingestion/slideLabel";
import { LEGIBILITY_LABELS, splitUncertain, type SlideView } from "./slideReview";

const BADGE_CLASS: Record<SlideView["legibility"], string> = {
  clear: "bg-green-100 text-green-950 border-green-800",
  partial: "bg-amber-100 text-amber-950 border-amber-800",
  unreadable: "bg-red-100 text-red-950 border-red-800",
};

const buttonClass =
  "min-h-12 min-w-12 rounded-lg px-5 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-60";

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitUncertain(text).map((part, i) =>
        part.uncertain ? (
          <span key={i}>
            <mark className="rounded bg-yellow-200 px-1 text-zinc-950 underline decoration-dashed decoration-2">
              {part.text}
            </mark>
            <span className="sr-only"> (uncertain)</span>
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function savedMessage(sentToReview: number): string {
  if (sentToReview === 0) return "Saved";
  return sentToReview === 1
    ? "Saved. 1 question that uses this slide now needs review."
    : `Saved. ${sentToReview} questions that use this slide now need review.`;
}

export function SlideCard({ slide, isAdmin }: { slide: SlideView; isAdmin: boolean }) {
  const heading = slideHeading({
    printed_slide_no: slide.printedSlideNo,
    page_no: slide.pageNo,
    position_on_page: slide.positionOnPage,
  });
  const [text, setText] = useState(slide.verbatimText);
  const [savedText, setSavedText] = useState(slide.verbatimText);
  const [corrected, setCorrected] = useState(slide.adminCorrected);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const hasUncertainMarks = splitUncertain(savedText).some((part) => part.uncertain);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateSlideText(slide.id, text);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setSavedText(text);
      setCorrected(true);
      setMessage({ kind: "ok", text: savedMessage(result.questionsSentToReview) });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function viewPhoto() {
    setPhotoError(null);
    // Open the tab now, inside the click, so browsers do not block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const url = await getPageViewUrl(slide.pageId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (err) {
      tab?.close();
      setPhotoError(err instanceof Error ? err.message : "Could not open the photo.");
    }
  }

  return (
    <article aria-label={heading} className="rounded-xl border-2 border-zinc-300 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-xl font-bold">{heading}</h4>
        <span
          className={`rounded-full border-2 px-3 py-1 text-base font-semibold ${BADGE_CLASS[slide.legibility]}`}
        >
          {LEGIBILITY_LABELS[slide.legibility]}
        </span>
        {corrected ? (
          <span className="rounded-full border-2 border-blue-900 bg-blue-100 px-3 py-1 text-base font-semibold text-blue-950">
            Corrected
          </span>
        ) : null}
      </div>
      {slide.title ? <p className="mt-2 text-lg font-semibold">{slide.title}</p> : null}

      {isAdmin && hasUncertainMarks ? (
        <p className="mt-3 whitespace-pre-wrap text-lg">
          <span className="block text-base font-semibold">Unclear words are highlighted:</span>
          <Highlighted text={savedText} />
        </p>
      ) : null}
      {isAdmin ? (
        <div className="mt-3">
          <label htmlFor={`text-${slide.id}`} className="block font-semibold">
            Slide text
          </label>
          <textarea
            id={`text-${slide.id}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={6}
            className="mt-1 w-full rounded-lg border border-zinc-500 bg-white p-3 text-lg text-zinc-950"
          />
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-lg">
          <Highlighted text={savedText} />
        </p>
      )}

      {slide.uncertainTerms.length > 0 ? (
        <p className="mt-3">
          <span className="font-semibold">Words to check: </span>
          {slide.uncertainTerms.join(", ")}
        </p>
      ) : null}
      {slide.cropped ? (
        <p className="mt-2">Part of this slide was cut off in the photo.</p>
      ) : null}

      {slide.tables.map((table, t) => (
        <div key={t} className="mt-3 overflow-x-auto">
          <table className="border-collapse text-base">
            {table.caption ? <caption className="mb-1 text-left font-semibold">{table.caption}</caption> : null}
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-zinc-400 px-2 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {slide.diagramDescription ? (
        <p className="mt-3">
          <span className="font-semibold">Diagram: </span>
          {slide.diagramDescription}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void viewPhoto()}
          className={`${buttonClass} border-2 border-blue-900 text-blue-900 hover:bg-blue-50`}
        >
          View photo
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || text === savedText}
            className={`${buttonClass} bg-blue-900 text-white hover:bg-blue-800`}
          >
            {saving ? "Saving…" : "Save correction"}
          </button>
        ) : null}
        <p role="status" className={message?.kind === "error" ? "font-bold text-red-800" : "font-semibold"}>
          {message?.text}
        </p>
        {photoError ? (
          <p role="alert" className="font-bold text-red-800">
            {photoError}
          </p>
        ) : null}
      </div>
    </article>
  );
}
