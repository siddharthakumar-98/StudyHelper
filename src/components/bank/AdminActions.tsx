"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ActionResult } from "@/modules/bank/actionResult";
import {
  approveQuestion,
  editQuestion,
  regenerateQuestion,
  rejectQuestion,
} from "@/modules/bank/actions";
import {
  GENERIC_ERROR,
  STALE_COPY,
  isStaleError,
  regenerateMessage,
  type Status,
} from "./bankView";
import { EditQuestionForm } from "./EditQuestionForm";
import type { EditPayload, McqForm, SaqForm } from "./editQuestion";
import { useHydrated } from "./useHydrated";

type Props = {
  id: string;
  status: Status;
  /** QuestionDetail.version: sent with edit and regenerate so a stale page is refused. */
  version: number;
  type: "mcq" | "saq" | "essay";
  /** Starting values for the edit form (admins only, so the key may be in here). */
  form: { kind: "mcq"; value: McqForm } | { kind: "saq"; value: SaqForm } | null;
};

type Notice = { kind: "ok" | "error" | "stale"; text: string };
type Pending = "approve" | "reject" | "edit" | "regenerate";

const base =
  "tap rounded-lg px-5 text-lg font-bold disabled:cursor-not-allowed disabled:opacity-60";

const PENDING_COPY: Record<Pending, string> = {
  approve: "Approving…",
  reject: "Rejecting…",
  edit: "Saving…",
  regenerate: "Writing a new version… this can take a minute or two. Please keep this page open.",
};

/** Approve, Edit, Write a new version and Reject. Every button is disabled while one request runs. */
export function AdminActions({ id, status, version, type, form }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const lock = useRef(false);

  const canApprove = status === "draft" || status === "needs_review" || status === "flagged";
  const canEdit = form !== null && (status === "needs_review" || status === "active" || status === "flagged");
  const canRegenerate = type !== "essay" && (status === "needs_review" || status === "active" || status === "flagged");
  const canReject = status !== "retired";
  if (!canApprove && !canEdit && !canRegenerate && !canReject && !notice) return null;

  function reload() {
    setNotice(null);
    setMode("idle");
    router.refresh();
  }

  /** Runs one request; a second click while it runs does nothing. Returns null when it threw. */
  async function run<T extends object>(
    name: Pending,
    call: () => Promise<ActionResult<T>>,
  ): Promise<ActionResult<T> | null> {
    if (lock.current) return null;
    lock.current = true;
    setPending(name);
    setNotice(null);
    try {
      const result = await call();
      if (!result.ok) {
        setNotice(
          isStaleError(result.error)
            ? { kind: "stale", text: STALE_COPY }
            : { kind: "error", text: result.error },
        );
      }
      return result;
    } catch {
      setNotice({ kind: "error", text: GENERIC_ERROR });
      return null;
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  async function approve() {
    const result = await run("approve", () => approveQuestion(id));
    if (result?.ok) {
      setNotice({ kind: "ok", text: "Approved. This question is now in practice tests." });
      router.refresh();
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setReasonError("Please say why you are rejecting this question.");
      return;
    }
    setReasonError(null);
    const result = await run("reject", () => rejectQuestion(id, reason.trim()));
    if (result?.ok) {
      setMode("idle");
      setReason("");
      setNotice({ kind: "ok", text: "Rejected. This question is retired." });
      router.refresh();
    }
  }

  async function regenerate() {
    const result = await run("regenerate", () => regenerateQuestion(id, version));
    if (result?.ok) {
      setNotice({ kind: "ok", text: regenerateMessage(result.status) });
      router.refresh();
    }
  }

  async function save(edit: EditPayload): Promise<ActionResult<{ version: number }> | null> {
    const result = await run("edit", () => editQuestion(id, edit, version));
    if (result?.ok) {
      setMode("idle");
      setNotice({ kind: "ok", text: `Saved as version ${result.version}.` });
      router.refresh();
    }
    // The form shows this result's problems itself, so keep the shared notice for other cases.
    if (result && !result.ok) setNotice(null);
    return result;
  }

  const busy = pending !== null;
  return (
    <section
      aria-label="Review tools"
      data-hydrated={hydrated ? "true" : "false"}
      className="mt-8 border-t-2 border-zinc-300 pt-6"
    >
      <h2 className="text-2xl font-bold">Review tools</h2>
      <div className="mt-3 flex flex-wrap gap-3">
        {canApprove ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void approve()}
            className={`${base} bg-green-800 text-white hover:bg-green-900`}
          >
            Approve
          </button>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            aria-expanded={mode === "edit"}
            onClick={() => {
              setNotice(null);
              setMode(mode === "edit" ? "idle" : "edit");
            }}
            className={`${base} border-2 border-blue-900 text-blue-900 hover:bg-blue-50`}
          >
            Edit
          </button>
        ) : null}
        {canRegenerate ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void regenerate()}
            className={`${base} border-2 border-blue-900 text-blue-900 hover:bg-blue-50`}
          >
            Write a new version
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            disabled={busy}
            aria-expanded={mode === "reject"}
            onClick={() => {
              setNotice(null);
              setReasonError(null);
              setMode(mode === "reject" ? "idle" : "reject");
            }}
            className={`${base} border-2 border-red-800 text-red-900 hover:bg-red-50`}
          >
            Reject
          </button>
        ) : null}
      </div>

      {pending ? (
        <p role="status" className="mt-3 text-lg font-semibold">
          {PENDING_COPY[pending]}
        </p>
      ) : null}
      {notice ? (
        <div
          role={notice.kind === "ok" ? "status" : "alert"}
          className={`mt-3 max-w-3xl rounded-lg border-2 p-3 text-lg font-semibold ${
            notice.kind === "ok"
              ? "border-green-800 bg-green-50 text-green-950"
              : notice.kind === "stale"
                ? "border-amber-800 bg-amber-50 text-amber-950"
                : "border-red-800 bg-red-50 text-red-900"
          }`}
        >
          <p>{notice.text}</p>
          {notice.kind === "stale" ? (
            <button
              type="button"
              onClick={reload}
              className="tap mt-2 rounded-lg border-2 border-amber-900 px-5 text-lg font-bold hover:bg-amber-100"
            >
              Reload
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "reject" ? (
        <div className="mt-4 max-w-3xl rounded-xl border-2 border-red-800 p-4">
          <label htmlFor="reject-reason" className="block text-lg font-semibold">
            Why are you rejecting it?
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-500 bg-white p-3 text-lg text-zinc-950"
          />
          {reasonError ? (
            <p role="alert" className="mt-2 font-bold text-red-800">
              {reasonError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void reject()}
              className={`${base} bg-red-800 text-white hover:bg-red-900`}
            >
              Reject this question
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("idle")}
              className={`${base} border-2 border-zinc-700 text-zinc-900 hover:bg-zinc-100`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === "edit" && form ? (
        <EditQuestionForm
          type={form.kind}
          initial={form.value}
          pending={busy}
          saving={pending === "edit"}
          onSave={save}
          onCancel={() => setMode("idle")}
          onReload={reload}
        />
      ) : null}
    </section>
  );
}
