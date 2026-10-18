"use client";

import { useState, useSyncExternalStore } from "react";
import { SlideCard } from "./SlideCard";
import { needsChecking, type SlideView } from "./slideReview";

/** Slides grouped by page, with a filter for the ones that need a second look. */
export function SlideList({ slides, isAdmin }: { slides: SlideView[]; isAdmin: boolean }) {
  const [onlyChecking, setOnlyChecking] = useState(false);
  // Lets tests (and nothing else) know the filter is interactive: a click before
  // hydration is lost, and webkit shows the server HTML long before it hydrates.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const shown = onlyChecking ? slides.filter(needsChecking) : slides;
  const pageNos = [...new Set(shown.map((s) => s.pageNo))];

  return (
    <div data-hydrated={hydrated ? "true" : "false"}>
      <label className="flex min-h-12 items-center gap-3 text-lg">
        <input
          type="checkbox"
          checked={onlyChecking}
          onChange={(event) => setOnlyChecking(event.target.checked)}
          className="size-6"
        />
        Show only slides that need checking
      </label>
      {shown.length === 0 ? (
        <p className="mt-4 text-lg">
          {slides.length === 0 ? "No slides have been read yet." : "No slides need checking."}
        </p>
      ) : (
        pageNos.map((pageNo) => (
          <section key={pageNo} aria-label={`Page ${pageNo}`} className="mt-6">
            <h3 className="mb-3 text-lg font-bold text-zinc-800">Page {pageNo}</h3>
            <div className="grid max-w-3xl gap-4">
              {shown
                .filter((s) => s.pageNo === pageNo)
                .map((slide) => (
                  <SlideCard
                    key={`${slide.id}:${slide.verbatimText}`}
                    slide={slide}
                    isAdmin={isAdmin}
                  />
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
