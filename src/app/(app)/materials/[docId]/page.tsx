import { notFound } from "next/navigation";
import { DocumentProgress } from "@/components/materials/DocumentProgress";
import { formatClassDate, pagesLabel, statusLabel } from "@/components/materials/status";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pageType(kind: string, storagePath: string): string {
  if (kind === "pdf_page") return "PDF";
  return storagePath.toLowerCase().endsWith(".png") ? "PNG" : "JPG";
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const user = await requireUser();
  const { docId } = await params;
  const { job } = await searchParams;
  if (!UUID.test(docId)) notFound();

  const supabase = await createServerSupabase();
  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, title, class_date, page_count, status")
    .eq("id", docId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the handout: ${error.message}`);
  if (!doc) notFound();

  const { data: pages, error: pagesError } = await supabase
    .from("source_pages")
    .select("page_no, kind, storage_path")
    .eq("document_id", docId)
    .order("page_no");
  if (pagesError) throw new Error(`Could not load the pages: ${pagesError.message}`);

  return (
    <>
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="mt-2 text-lg text-zinc-800">
        {formatClassDate(doc.class_date)} · {pagesLabel(doc.page_count)} ·{" "}
        {statusLabel(doc.status)}
      </p>
      {user.role === "admin" && job && UUID.test(job) ? (
        <div className="mt-6 max-w-xl">
          <DocumentProgress jobId={job} />
        </div>
      ) : null}
      {pages.length > 0 ? (
        <ul aria-label="Pages" className="mt-6 grid max-w-xl gap-2">
          {pages.map((page) => (
            <li
              key={page.page_no}
              className="flex items-center justify-between rounded-lg bg-zinc-100 px-4 py-3 text-lg"
            >
              <span className="font-semibold">Page {page.page_no}</span>
              <span>{pageType(page.kind, page.storage_path)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
