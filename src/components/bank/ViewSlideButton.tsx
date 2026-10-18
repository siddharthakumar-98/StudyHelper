"use client";

import { useState } from "react";
import { getPageViewUrl } from "@/modules/ingestion/upload";

/** Opens the handout page the slide came from, through a short-lived signed link. */
export function ViewSlideButton({ pageId }: { pageId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Open the tab now, inside the click, so browsers do not block it as a pop-up.
    const tab = window.open("", "_blank");
    try {
      const url = await getPageViewUrl(pageId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError("Could not open the slide. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="tap rounded-lg border-2 border-blue-900 px-4 text-lg font-bold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Opening…" : "View slide"}
      </button>
      {error ? (
        <span role="alert" className="font-bold text-red-800">
          {error}
        </span>
      ) : null}
    </span>
  );
}
