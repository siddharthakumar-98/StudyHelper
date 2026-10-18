"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/components/bank/useHydrated";
import { startQuestionWriting } from "@/modules/ingestion/upload";
import { ADMIN_REVIEW_LABEL } from "./status";

/**
 * The pause after extraction (R38): the admin checks the slides below, then starts
 * question writing. The page then runs the new job with the usual runner.
 */
export function WriteQuestions({ documentId }: { documentId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const result = await startQuestionWriting(documentId);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
      router.replace(`/materials/${documentId}?job=${result.jobId}`);
    } catch {
      setError("Could not start writing questions. Please try again.");
      setPending(false);
    }
  }

  return (
    <section
      aria-label="Next step"
      data-hydrated={hydrated ? "true" : "false"}
      className="rounded-lg border-2 border-blue-900 p-4"
    >
      <h2 className="text-xl font-bold">{ADMIN_REVIEW_LABEL}</h2>
      <p className="mt-2 text-lg">
        Check the slides, then write questions. Correct any slide text below first: questions are
        written from the text as it is now.
      </p>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="mt-4 min-h-14 min-w-48 rounded-lg bg-blue-900 px-6 text-xl font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Starting…" : "Write questions"}
      </button>
      {error ? (
        <p role="alert" className="mt-3 font-bold text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
