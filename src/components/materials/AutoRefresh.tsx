"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page on a timer, for viewers whose browser is not driving the pipeline. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
