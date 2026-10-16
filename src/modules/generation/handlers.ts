import type { JobHandler } from "@/modules/jobs/types";
import { slideLabel } from "@/modules/ingestion/slideLabel";
import { buildTopicMap, reconcileTopicMap, slideExcerpt, type TopicMapSlide } from "./topicMap";

/**
 * One step groups the handout's readable slides into topics (reusing topic names
 * from earlier handouts), then saves topics, slide links and the generation run
 * in one transaction (apply_topic_map). Idempotent: a repeat replaces this
 * document's links and reuses its open generation run instead of adding another.
 */
export const topicMapHandler: JobHandler = async ({ db, ai, documentId }) => {
  const { data: rows, error: slidesError } = await db
    .from("source_slides")
    .select(
      "id, position_on_page, printed_slide_no, title, verbatim_text, tables, diagram_description, legibility, source_pages!inner(page_no, document_id)",
    )
    .eq("source_pages.document_id", documentId);
  if (slidesError) throw new Error(`Could not read the handout's slides: ${slidesError.message}`);
  if (rows.length === 0) throw new Error("This handout has no slides to group into topics");

  const slides: TopicMapSlide[] = rows
    .map((row) => ({ row, pageNo: row.source_pages.page_no }))
    .sort((a, b) => a.pageNo - b.pageNo || a.row.position_on_page - b.row.position_on_page)
    .map(({ row, pageNo }) => ({
      id: row.id,
      label: slideLabel({
        printed_slide_no: row.printed_slide_no,
        page_no: pageNo,
        position_on_page: row.position_on_page,
      }),
      title: row.title,
      text: slideExcerpt(row),
      legibility: row.legibility,
    }));

  const { data: existing, error: topicsError } = await db.from("topics").select("name").order("name");
  if (topicsError) throw new Error(`Could not read the existing topics: ${topicsError.message}`);

  const map = await buildTopicMap(
    slides,
    existing.map((t) => t.name),
    ai,
    documentId,
  );
  const reconciled = reconcileTopicMap(
    map,
    slides.map((s) => s.id),
    slides.filter((s) => s.legibility !== "unreadable").map((s) => s.id),
  );

  const { data: runId, error: applyError } = await db.rpc("apply_topic_map", {
    p_document_id: documentId,
    p_topics: reconciled.topics.map((t) => ({ name: t.name, slide_ids: t.slideIds })),
  });
  if (applyError || !runId) {
    throw new Error(`Could not save the topics: ${applyError?.message ?? "no run returned"}`);
  }

  return {
    done: true,
    progress: {
      current: 1,
      total: 1,
      label: `Grouped ${slides.length} slides into ${reconciled.topics.length} topics`,
    },
    next: { kind: "generate", payload: { runId } },
  };
};
