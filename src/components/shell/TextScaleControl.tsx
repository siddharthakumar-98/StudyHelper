"use client";

import { useTextScale } from "./useTextScale";

const buttonClass =
  "tap rounded-lg border-2 border-blue-900 bg-white px-3 font-bold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-zinc-500 disabled:text-zinc-600";

export function TextScaleControl() {
  const { scale, increase, decrease } = useTextScale();
  return (
    <div role="group" aria-label="Text size" className="flex items-center gap-2">
      <button type="button" onClick={decrease} disabled={scale === 1} className={buttonClass}>
        A-<span className="sr-only"> smaller text</span>
      </button>
      <button type="button" onClick={increase} disabled={scale === 1.3} className={buttonClass}>
        A+<span className="sr-only"> larger text</span>
      </button>
    </div>
  );
}
