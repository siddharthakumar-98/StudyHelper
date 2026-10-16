"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { flagQuestion } from "@/modules/bank/actions";
import { GENERIC_ERROR } from "./bankView";
import { useHydrated } from "./useHydrated";

export const FLAG_THANKS = "Thanks — this question is now out of practice tests until it's checked.";
const ALREADY_FLAGGED = "This question has been flagged. It is out of practice tests until it's checked.";

/** "Flag a problem" for anyone reading a question; the thank-you stays after the page refreshes. */
export function FlagDialog({ questionId, flagged }: { questionId: string; flagged: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  async function send() {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setError(null);
    try {
      const result = await flagQuestion(questionId, comment.trim() || null);
      if (result.ok) {
        setSent(true);
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      lock.current = false;
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        data-hydrated={hydrated ? "true" : "false"}
        className="rounded-lg border-2 border-green-800 bg-green-50 p-4 text-lg font-semibold text-green-950"
      >
        {FLAG_THANKS}
      </p>
    );
  }
  if (flagged) {
    return (
      <p data-hydrated={hydrated ? "true" : "false"} className="rounded-lg border-2 border-zinc-400 p-4 text-lg">
        {ALREADY_FLAGGED}
      </p>
    );
  }

  return (
    <div data-hydrated={hydrated ? "true" : "false"}>
      <Dialog.Root open={open} onOpenChange={(next) => (sending ? undefined : setOpen(next))}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            className="tap rounded-lg border-2 border-zinc-700 px-5 text-lg font-bold text-zinc-900 hover:bg-zinc-100"
          >
            Flag a problem
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <Dialog.Title className="text-2xl font-bold">Flag a problem</Dialog.Title>
            <Dialog.Description className="mt-2 text-lg">
              Tell us what looks wrong. This question is taken out of practice tests until it has been
              checked.
            </Dialog.Description>
            <label htmlFor="flag-comment" className="mt-4 block text-lg font-semibold">
              What looks wrong? (optional)
            </label>
            <textarea
              id="flag-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={4}
              className="mt-1 w-full rounded-lg border border-zinc-500 bg-white p-3 text-lg text-zinc-950"
            />
            {error ? (
              <p role="alert" className="mt-3 font-bold text-red-800">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="tap rounded-lg bg-blue-900 px-6 text-lg font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-zinc-500"
              >
                {sending ? "Sending…" : "Send flag"}
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={sending}
                  className="tap rounded-lg border-2 border-zinc-700 px-6 text-lg font-bold text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
