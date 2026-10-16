import { notFound } from "next/navigation";
import { DocumentProgress } from "@/components/materials/DocumentProgress";
import { formatClassDate, pagesLabel, statusLabel } from "@/components/materials/status";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { SlideList } from "@/components/materials/SlideList";
import { parseTables, type SlideView } from "@/components/materials/slideReview";
import { getLatestJobId } from "@/modules/ingestion/upload";

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

  const { data: slidePages, error: slidesError } = await supabase
    .from("source_pages")
    .select(
      "id, page_no, source_slides(id, position_on_page, printed_slide_no, title, verbatim_text, tables, diagram_description, legibility, uncertain_terms, cropped, admin_corrected)",
    )
    .eq("document_id", docId)
    .order("page_no")
    .order("position_on_page", { referencedTable: "source_slides" });
  if (slidesError) throw new Error(`Could not load the slides: ${slidesError.message}`);
  const slides: SlideView[] = slidePages.flatMap((p) =>
    p.source_slides.map((s) => ({
      id: s.id,
      pageId: p.id,
      pageNo: p.page_no,
      positionOnPage: s.position_on_page,
      printedSlideNo: s.printed_slide_no,
      title: s.title,
      verbatimText: s.verbatim_text,
      tables: parseTables(s.tables),
      diagramDescription: s.diagram_description,
      legibility: s.legibility,
      uncertainTerms: s.uncertain_terms,
      cropped: s.cropped,
      adminCorrected: s.admin_corrected,
    })),
  );

  const isAdmin = user.role === "admin";
  const latestJobId = await getLatestJobId(docId);
  const progressJobId = isAdmin ? (job && UUID.test(job) ? job : latestJobId) : null;

  return (
    <>
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="mt-2 text-lg text-zinc-800">
        {formatClassDate(doc.class_date)} · {pagesLabel(doc.page_count)} ·{" "}
        {statusLabel(doc.status)}
      </p>
      {progressJobId ? (
        <div className="mt-6 max-w-xl">
          <DocumentProgress jobId={progressJobId} />
        </div>
      ) : null}
      {!isAdmin && latestJobId ? (
        <p role="status" className="mt-6 max-w-xl rounded-lg border-2 border-zinc-300 p-4 text-lg">
          This handout is still being prepared. Slides appear below as they are read.
        </p>
      ) : null}
      {/* Task 14 adds the "Coverage report" section here. */}
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
      <section aria-label="Slides" className="mt-10">
        <h2 className="text-2xl font-bold">Slides</h2>
        <SlideList slides={slides} isAdmin={isAdmin} />
      </section>
    </>
  );
}
