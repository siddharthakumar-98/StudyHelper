import type { Json } from "@/lib/supabase/database.types";
import type { JobHandler } from "@/modules/jobs/types";
import { extractPage } from "./extractSlides";
import { MATERIALS_BUCKET, PAGE_MIME, pageMime, pagePath, type PageExt } from "./paths";
import { splitPdf } from "./splitPdf";

const IMAGE_EXT: Record<string, PageExt> = { "image/jpeg": "jpg", "image/png": "png" };

/**
 * Step i turns file i into numbered pages. Idempotent per file: it first removes
 * that file's earlier pages (rows and objects), so a retry or a duplicate run
 * leaves the same rows. The last step records the page count and hands over to extract.
 * Once slides have been extracted a (late, duplicate) split is a no-op: deleting
 * the pages would cascade-delete the slides.
 */
export const splitHandler: JobHandler = async ({ db, documentId, step }) => {
  const storage = db.storage.from(MATERIALS_BUCKET);

  const { data: files, error: filesError } = await db
    .from("document_files")
    .select("file_index, storage_path, mime_type")
    .eq("document_id", documentId)
    .order("file_index");
  if (filesError) throw new Error(`Could not read the handout's files: ${filesError.message}`);
  if (files.length === 0) throw new Error("This handout has no files to split");

  const { count: slideCount, error: slidesError } = await db
    .from("source_slides")
    .select("id, source_pages!inner(document_id)", { count: "exact", head: true })
    .eq("source_pages.document_id", documentId);
  if (slidesError || slideCount === null) {
    throw new Error(`Could not check for extracted slides: ${slidesError?.message ?? "unknown error"}`);
  }
  if (slideCount > 0) {
    return {
      done: true,
      progress: { current: files.length, total: files.length, label: "Pages already read" },
    };
  }

  const file = files.find((f) => f.file_index === step);
  if (!file) throw new Error(`Handout file ${step + 1} was not found`);

  // Forget this file's earlier pages first (replace, not append).
  const { data: stale, error: staleError } = await db
    .from("source_pages")
    .select("storage_path")
    .eq("document_id", documentId)
    .eq("source_file_index", step);
  if (staleError) throw new Error(`Could not read earlier pages: ${staleError.message}`);
  if (stale.length > 0) {
    const { error: removeError } = await storage.remove(stale.map((p) => p.storage_path));
    if (removeError) throw new Error(`Could not remove earlier pages: ${removeError.message}`);
    const { error: deleteError } = await db
      .from("source_pages")
      .delete()
      .eq("document_id", documentId)
      .eq("source_file_index", step);
    if (deleteError) throw new Error(`Could not clear earlier pages: ${deleteError.message}`);
  }

  // Page numbers continue after the pages of earlier files.
  const { data: before, error: beforeError } = await db
    .from("source_pages")
    .select("page_no")
    .eq("document_id", documentId)
    .lt("source_file_index", step)
    .order("page_no", { ascending: false })
    .limit(1);
  if (beforeError) throw new Error(`Could not number the pages: ${beforeError.message}`);
  const offset = before[0]?.page_no ?? 0;

  const { data: blob, error: downloadError } = await storage.download(file.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Could not read file ${step + 1}: ${downloadError?.message ?? "missing"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const pages: { pageNo: number; ext: PageExt; body: Uint8Array }[] = [];
  if (file.mime_type === "application/pdf") {
    const parts = await splitPdf(bytes);
    parts.forEach((body, i) => pages.push({ pageNo: offset + i + 1, ext: "pdf", body }));
  } else if (IMAGE_EXT[file.mime_type]) {
    pages.push({ pageNo: offset + 1, ext: IMAGE_EXT[file.mime_type], body: bytes });
  } else {
    throw new Error(`File ${step + 1} is not a PDF, JPG or PNG`);
  }

  const rows: {
    document_id: string;
    page_no: number;
    source_file_index: number;
    kind: "pdf_page" | "image";
    storage_path: string;
  }[] = [];
  for (const page of pages) {
    const path = pagePath(documentId, page.pageNo, page.ext);
    const { error } = await storage.upload(path, page.body, {
      contentType: PAGE_MIME[page.ext],
      upsert: true,
    });
    if (error) throw new Error(`Could not save page ${page.pageNo}: ${error.message}`);
    rows.push({
      document_id: documentId,
      page_no: page.pageNo,
      source_file_index: step,
      kind: page.ext === "pdf" ? "pdf_page" : "image",
      storage_path: path,
    });
  }
  const { error: insertError } = await db.from("source_pages").insert(rows);
  if (insertError) throw new Error(`Could not record pages: ${insertError.message}`);

  const isLast = step >= files.length - 1;
  if (!isLast) {
    return {
      done: false,
      progress: { current: step + 1, total: files.length, label: `Split file ${step + 1} of ${files.length}` },
    };
  }

  const { count, error: countError } = await db
    .from("source_pages")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);
  if (countError || count === null) {
    throw new Error(`Could not count pages: ${countError?.message ?? "unknown error"}`);
  }
  // Only moves the status forward: a duplicate split must not undo later stages.
  const { error: updateError } = await db
    .from("documents")
    .update({ page_count: count, status: "processing" })
    .eq("id", documentId)
    .in("status", ["uploading", "splitting"]);
  if (updateError) throw new Error(`Could not update the handout: ${updateError.message}`);

  return {
    done: true,
    progress: { current: files.length, total: files.length, label: `Split into ${count} pages` },
    next: { kind: "extract", payload: {} },
  };
};

/**
 * Step i reads the i-th page (by page_no) into slides. Each step replaces that
 * page's slides in one transaction, so retries and duplicates never add rows.
 * The last step hands over to topic_map.
 */
export const extractHandler: JobHandler = async ({ db, ai, documentId, step }) => {
  const { data: pages, error: pagesError } = await db
    .from("source_pages")
    .select("id, page_no, kind, storage_path")
    .eq("document_id", documentId)
    .order("page_no");
  if (pagesError) throw new Error(`Could not read the handout's pages: ${pagesError.message}`);
  if (pages.length === 0) throw new Error("This handout has no pages to read");

  const page = pages[step];
  if (!page) throw new Error(`Page ${step + 1} was not found`);
  const total = pages.length;

  const mime = pageMime(page.storage_path);
  if (!mime) throw new Error(`Page ${page.page_no} has an unknown file type`);

  const { data: blob, error: downloadError } = await db.storage
    .from(MATERIALS_BUCKET)
    .download(page.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Could not read page ${page.page_no}: ${downloadError?.message ?? "missing"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const slides = await extractPage(
    { kind: page.kind, storagePath: page.storage_path, mime, pageNo: page.page_no },
    bytes,
    ai,
    documentId,
  );

  const { error: replaceError } = await db.rpc("replace_page_slides", {
    p_page_id: page.id,
    p_slides: slides as Json,
  });
  if (replaceError) {
    throw new Error(`Could not save the slides of page ${page.page_no}: ${replaceError.message}`);
  }

  const progress = { current: step + 1, total, label: `Reading page ${step + 1} of ${total}` };
  if (step < total - 1) return { done: false, progress };
  return { done: true, progress, next: { kind: "topic_map", payload: {} } };
};
