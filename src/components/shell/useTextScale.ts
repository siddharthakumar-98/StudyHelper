"use client";

import { useCallback, useSyncExternalStore } from "react";

export const TEXT_SCALES = [1, 1.15, 1.3] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export const TEXT_SCALE_KEY = "sh.textScale";

const listeners = new Set<() => void>();

function read(): TextScale {
  try {
    const stored = Number(window.localStorage.getItem(TEXT_SCALE_KEY));
    return TEXT_SCALES.find((s) => s === stored) ?? 1;
  } catch {
    return 1;
  }
}

function write(scale: TextScale) {
  document.documentElement.style.setProperty("--text-scale", String(scale));
  try {
    window.localStorage.setItem(TEXT_SCALE_KEY, String(scale));
  } catch {
    // Storage can be blocked (private mode); the scale still applies this visit.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/**
 * Text size remembered per device. The server and first client render use 1;
 * an inline script in the root layout applies the saved value to <html> before
 * paint, so the page never flashes at the wrong size.
 */
export function useTextScale(): {
  scale: TextScale;
  increase(): void;
  decrease(): void;
} {
  const scale = useSyncExternalStore(subscribe, read, () => 1 as TextScale);

  const step = useCallback((direction: 1 | -1) => {
    const index = TEXT_SCALES.indexOf(read());
    const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, index + direction))];
    write(next);
  }, []);

  return {
    scale,
    increase: useCallback(() => step(1), [step]),
    decrease: useCallback(() => step(-1), [step]),
  };
}
