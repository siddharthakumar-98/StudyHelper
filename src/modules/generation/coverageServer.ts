import "server-only";
import { requireUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { QuestionStatus } from "@/modules/bank/lifecycle";
import { slideHeading } from "@/modules/ingestion/slideLabel";
import {
  DEFAULT_TARGET,
  buildCoverageReport,
  type CoverageInput,
  type CoverageReport,
} from "./coverage";

const PAGE = 1000;

function citedSlideIds(sourceRefs: unknown): string[] {
  if (!Array.isArray(sourceRefs)) return [];
  const ids: string[] = [];
  for (const ref of sourceRefs) {
    const id = (ref as { slideId?: unknown } | null)?.slideId;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/**
 * The coverage report for one handout. Any signed-in user may read it: it holds
 * counts and slide labels only, never answer keys or review notes. Counts come from
 * the service client so a student sees the same totals as the admin (RLS would hide
 * the questions that still need review).
 */
export async function getCoverageReport(documentId: string): Promise<CoverageReport> {
  await requireUser();
  const db = createServiceSupabase();

  const { data: pages, error: pagesError } = await db
    .from("source_pages")
    .select(
      "page_no, source_slides(id, position_on_page, printed_slide_no, legibility)",
    )
    .eq("document_id", documentId)
    .order("page_no");
  if (pagesError) throw new Error(`Could not load the slides: ${pagesError.message}`);
  const slideRows = pages.flatMap((p) =>
    p.source_slides.map((s) => ({
      id: s.id,
      label: slideHeading({
        printed_slide_no: s.printed_slide_no,
        page_no: p.page_no,
        position_on_page: s.position_on_page,
      }),
      legibility: s.legibility,
      positionKey: p.page_no * 1000 + s.position_on_page,
    })),
  );
  slideRows.sort((a, b) => a.positionKey - b.positionKey);
  const slideIds = slideRows.map((s) => s.id);
  const slideIdSet = new Set(slideIds);

  const topicIdsBySlide = new Map<string, string[]>();
  if (slideIds.length > 0) {
    const { data: links, error } = await db
      .from("slide_topics")
      .select("slide_id, topic_id")
      .in("slide_id", slideIds);
    if (error) throw new Error(`Could not load the topics: ${error.message}`);
    for (const l of links) {
      topicIdsBySlide.set(l.slide_id, [...(topicIdsBySlide.get(l.slide_id) ?? []), l.topic_id]);
    }
  }
  const topicIds = [...new Set([...topicIdsBySlide.values()].flat())];

  let topics: CoverageInput["topics"] = [];
  const questions: CoverageInput["questions"] = [];
  if (topicIds.length > 0) {
    const { data, error } = await db
      .from("topics")
      .select("id, name")
      .in("id", topicIds)
      .order("name");
    if (error) throw new Error(`Could not load the topics: ${error.message}`);
    topics = data;

    // Questions belong to topics, and topics are shared between handouts, so keep
    // only the questions whose current version cites one of this handout's slides.
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error: qError } = await db
        .from("questions")
        .select(
          "id, type, status, topic_id, difficulty, current_version, question_versions(version, source_refs)",
        )
        .in("topic_id", topicIds)
        .order("id")
        .range(from, from + PAGE - 1);
      if (qError) throw new Error(`Could not load the questions: ${qError.message}`);
      for (const row of rows) {
        if (row.type === "essay") continue;
        const current = row.question_versions.find((v) => v.version === row.current_version);
        const sourceSlideIds = citedSlideIds(current?.source_refs).filter((id) =>
          slideIdSet.has(id),
        );
        if (sourceSlideIds.length === 0) continue;
        questions.push({
          id: row.id,
          type: row.type,
          difficulty: row.difficulty,
          status: row.status as QuestionStatus,
          topicId: row.topic_id,
          sourceSlideIds,
        });
      }
      if (rows.length < PAGE) break;
    }
  }

  return buildCoverageReport({
    target: DEFAULT_TARGET,
    topics,
    slides: slideRows.map((s) => ({
      id: s.id,
      label: s.label,
      legibility: s.legibility,
      topicIds: topicIdsBySlide.get(s.id) ?? [],
    })),
    questions,
  });
}
