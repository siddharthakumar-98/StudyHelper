"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { prepareImage } from "@/modules/ingestion/prepareImage";
import { createUpload, finalizeUpload } from "@/modules/ingestion/upload";
import { validateUploadFiles } from "@/modules/ingestion/validateUpload";

type FileState = { status: "waiting" | "preparing" | "uploading" | "done" | "error"; message?: string };

const STATUS_TEXT: Record<FileState["status"], string> = {
  waiting: "Waiting",
  preparing: "Getting ready…",
  uploading: "Uploading…",
  done: "Uploaded",
  error: "Problem",
};

const inputClass =
  "min-h-12 w-full rounded-lg border border-zinc-500 bg-white px-4 text-lg text-zinc-950";

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [classDate, setClassDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [states, setStates] = useState<FileState[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Lets tests (and nothing else) know the form is interactive.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const setState = (index: number, state: FileState) =>
    setStates((current) => current.map((s, i) => (i === index ? state : s)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = validateUploadFiles(files);
    if (title.trim().length === 0) problems.unshift("Enter a title");
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setBusy(true);
    setStates(files.map(() => ({ status: "waiting" })));

    let current = 0;
    try {
      const prepared: File[] = [];
      for (current = 0; current < files.length; current++) {
        setState(current, { status: "preparing" });
        prepared.push(await prepareImage(files[current]));
      }
      const { documentId, uploads } = await createUpload({
        title,
        classDate: classDate || null,
        files: prepared.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      });
      const storage = createBrowserSupabase().storage.from("materials");
      for (const ticket of uploads) {
        current = ticket.fileIndex;
        setState(current, { status: "uploading" });
        const file = prepared[ticket.fileIndex];
        const { error } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type,
        });
        if (error) throw new Error(error.message);
        setState(current, { status: "done" });
      }
      const { jobId } = await finalizeUpload(documentId);
      router.push(`/materials/${documentId}?job=${jobId}`);
    } catch (err) {
      console.error(err);
      setState(current, { status: "error" });
      setErrors([
        "Something went wrong while adding the handout. Check your connection and try again.",
      ]);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-hydrated={hydrated ? "true" : "false"}
      className="mt-6 flex max-w-xl flex-col gap-5 rounded-xl border-2 border-zinc-300 p-5"
    >
      <h2 className="text-2xl font-bold">Add a handout</h2>
      <label className="flex flex-col gap-2 text-lg">
        Title
        <input
          type="text"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-2 text-lg">
        Class date (optional)
        <input
          type="date"
          name="classDate"
          value={classDate}
          onChange={(e) => setClassDate(e.target.value)}
          disabled={busy}
          className={inputClass}
        />
      </label>
      <div className="flex flex-col gap-2 text-lg">
        <label htmlFor="handout-files">Pages (PDF or photos)</label>
        <input
          ref={fileInput}
          id="handout-files"
          type="file"
          accept=".pdf,image/*,.heic,.heif"
          multiple
          disabled={busy}
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setStates([]);
            setErrors([]);
          }}
          className="min-h-12 w-full rounded-lg border border-zinc-500 bg-white p-2 text-lg"
        />
      </div>

      {files.length > 0 ? (
        <ul aria-label="Chosen files" className="flex flex-col gap-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-100 px-4 py-3"
            >
              <span className="min-w-0 break-all font-semibold">
                {file.name} <span className="font-normal text-zinc-700">({sizeLabel(file.size)})</span>
              </span>
              <span
                className={states[i]?.status === "error" ? "font-bold text-red-800" : "text-zinc-800"}
              >
                {STATUS_TEXT[states[i]?.status ?? "waiting"]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {errors.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 font-bold text-red-800">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="tap min-h-14 rounded-lg bg-blue-900 px-6 text-xl font-bold text-white hover:bg-blue-800 disabled:bg-zinc-500"
      >
        {busy ? "Adding…" : "Add handout"}
      </button>
    </form>
  );
}
