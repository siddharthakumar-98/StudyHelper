import Link from "next/link";
import { formatClassDate, pagesLabel, statusLabel } from "@/components/materials/status";
import { UploadForm } from "@/components/materials/UploadForm";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function MaterialsPage() {
  const user = await requireUser();
  const supabase = await createServerSupabase();
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, title, class_date, page_count, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load materials: ${error.message}`);

  return (
    <>
      <h1 className="text-3xl font-bold">Materials</h1>
      {documents.length === 0 ? (
        <p className="mt-4 text-lg">No handouts yet.</p>
      ) : (
        <ul className="mt-6 grid max-w-3xl gap-3">
          {documents.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/materials/${doc.id}`}
                className="tap flex flex-col gap-1 rounded-xl border-2 border-zinc-300 p-4 hover:bg-zinc-50"
              >
                <span className="text-xl font-bold text-blue-900">{doc.title}</span>
                <span className="text-zinc-800">
                  {formatClassDate(doc.class_date)} · {pagesLabel(doc.page_count)} ·{" "}
                  {statusLabel(doc.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {user.role === "admin" ? <UploadForm /> : null}
    </>
  );
}
