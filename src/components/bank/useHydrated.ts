"use client";

import { useSyncExternalStore } from "react";

/**
 * False in the server HTML, true once React has taken over the page. Components put it
 * on a `data-hydrated` attribute so tests (and nothing else) know a click will land:
 * webkit paints the server HTML long before it hydrates.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
