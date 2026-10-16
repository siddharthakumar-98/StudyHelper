import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { JobHandler } from "@/modules/jobs/types";
import type { GeneratedMcq, GeneratedSaq } from "@/modules/ai/schemas/generation";
import { MATERIALS_BUCKET } from "@/modules/ingestion/paths";
import { slideLabel } from "@/modules/ingestion/slideLabel";
import {
  generateForTopic,
  needsPagePhoto,
  planTopicBatches,
  targetsFor,
  type SlideForGeneration,
} from "./generate";
import { buildTopicMap, reconcileTopicMap, slideExcerpt, type TopicMapSlide } from "./topicMap";
import { AUTO_CHECK_PREFIX, isMcq, validateGenerated } from "./validate";

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

  if (reconciled.droppedIds.length > 0) {
    console.warn(
      `topic_map: dropped ${reconciled.droppedIds.length} unknown slide id(s) from the model's answer for document ${documentId}`,
    );
  }

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

type Db = SupabaseClient<Database>;

type PlanSlide = SlideForGeneration & { pageNo: number; positionOnPage: number; storagePath: string };

type PlanBatch = {
  topicId: string;
  topicName: string;
  batchIndex: number;
  batchKey: string;
  slides: PlanSlide[];
  /** The topic's other readable slides, shown read-only so cross-batch contradictions are visible. */
  otherSlides: PlanSlide[];
};

/**
 * The generate stage's units of work: one batch of at most 6 readable slides per
 * (topic, batch index), topics ordered by name and slides by page and position.
 * Recomputed from the database on every step, so each step sees the same plan.
 */
async function loadGenerationPlan(db: Db, documentId: string): Promise<PlanBatch[]> {
  const { data, error } = await db
    .from("slide_topics")
    .select(
      "topic_id, topics!inner(name), source_slides!inner(id, page_id, position_on_page, printed_slide_no, title, verbatim_text, tables, diagram_description, legibility, source_pages!inner(page_no, storage_path, document_id))",
    )
    .eq("source_slides.source_pages.document_id", documentId)
    .neq("source_slides.legibility", "unreadable");
  if (error) throw new Error(`Could not read the handout's topics: ${error.message}`);

  const topics = new Map<string, { name: string; slides: PlanSlide[] }>();
  for (const row of data) {
    const slide = row.source_slides;
    const page = slide.source_pages;
    const topic = topics.get(row.topic_id) ?? { name: row.topics.name, slides: [] };
    topics.set(row.topic_id, topic);
    topic.slides.push({
      id: slide.id,
      label: slideLabel({
        printed_slide_no: slide.printed_slide_no,
        page_no: page.page_no,
        position_on_page: slide.position_on_page,
      }),
      pageId: slide.page_id,
      title: slide.title,
      verbatim_text: slide.verbatim_text,
      tables: Array.isArray(slide.tables) ? slide.tables : [],
      diagram_description: slide.diagram_description,
      pageNo: page.page_no,
      positionOnPage: slide.position_on_page,
      storagePath: page.storage_path,
    });
  }

  const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...topics.entries()]
    .sort(([idA, a], [idB, b]) => byCodePoint(a.name, b.name) || byCodePoint(idA, idB))
    .flatMap(([topicId, topic]) => {
      const ordered = [...topic.slides].sort(
        (a, b) => a.pageNo - b.pageNo || a.positionOnPage - b.positionOnPage,
      );
      return planTopicBatches(ordered).map((slides, batchIndex) => ({
        topicId,
        topicName: topic.name,
        batchIndex,
        batchKey: `${topicId}:${batchIndex}`,
        slides,
        otherSlides: ordered.filter((s) => !slides.includes(s)),
      }));
    });
}

/**
 * Current stems of the topic's non-retired questions, from every handout. The
 * batch's own drafts are left out: this step replaces them.
 */
async function loadAvoidStems(db: Db, batch: PlanBatch, runId: string): Promise<string[]> {
  const { data, error } = await db
    .from("questions")
    .select("status, current_version, generation_run_id, batch_key, question_versions(version, stem)")
    .eq("topic_id", batch.topicId)
    .neq("status", "retired")
    .order("created_at");
  if (error) throw new Error(`Could not read the topic's questions: ${error.message}`);
  return data
    .filter(
      (q) => !(q.status === "draft" && q.generation_run_id === runId && q.batch_key === batch.batchKey),
    )
    .map((q) => q.question_versions.find((v) => v.version === q.current_version)?.stem)
    .filter((stem): stem is string => Boolean(stem));
}

/** The page files of the batch's slides that get a photo, one per page. */
async function loadPagePhotos(db: Db, slides: PlanSlide[]): Promise<Map<string, Uint8Array>> {
  const pages = new Map<string, PlanSlide>();
  for (const slide of slides) {
    if (needsPagePhoto(slide) && !pages.has(slide.pageId)) pages.set(slide.pageId, slide);
  }
  const photos = new Map<string, Uint8Array>();
  for (const [pageId, slide] of pages) {
    const { data, error } = await db.storage.from(MATERIALS_BUCKET).download(slide.storagePath);
    if (error || !data) {
      throw new Error(`Could not read page ${slide.pageNo}: ${error?.message ?? "missing"}`);
    }
    photos.set(pageId, new Uint8Array(await data.arrayBuffer()));
  }
  return photos;
}

/** One question as save_generated_questions expects it, with its pre-check notes. */
function toSaveItem(
  q: GeneratedMcq | GeneratedSaq,
  batch: PlanBatch,
  documentId: string,
): Record<string, Json> {
  const inBatch = new Map(batch.slides.map((s) => [s.id, s]));
  const sourceRefs = q.source_slide_ids.flatMap((id) => {
    const slide = inBatch.get(id);
    return slide ? [{ documentId, pageNo: slide.pageNo, slideId: slide.id, label: slide.label }] : [];
  });
  const common = {
    difficulty: q.difficulty,
    stem: q.stem,
    source_refs: sourceRefs,
    basis_quote: q.basis_quote,
    conflict_note: q.conflict_note,
    review_notes: validateGenerated(q, inBatch).map((issue) => `${AUTO_CHECK_PREFIX}${issue}`),
  };
  if (isMcq(q)) {
    return {
      ...common,
      type: "mcq",
      options: q.options,
      correct_option_id: q.correct_option_id,
      explanation: q.explanation,
      model_answer: null,
      key_concepts: null,
      rubric: null,
    };
  }
  return {
    ...common,
    type: "saq",
    options: null,
    correct_option_id: null,
    explanation: null,
    model_answer: q.model_answer,
    key_concepts: q.key_concepts,
    rubric: q.rubric,
  };
}

/** Deletes the run's drafts from batches that are not in the current plan. */
async function deleteStaleDrafts(db: Db, runId: string, plan: PlanBatch[]): Promise<void> {
  const { error } = await db.rpc("delete_stale_draft_batches", {
    p_run_id: runId,
    p_keep_batch_keys: plan.map((b) => b.batchKey),
  });
  if (error) throw new Error(`Could not clear earlier drafts: ${error.message}`);
}

/**
 * Step k writes the questions of batch k of the plan (loadGenerationPlan) and
 * saves them as drafts with their pre-check notes, replacing that batch's
 * earlier drafts in one transaction (save_generated_questions). Step 0 first,
 * and the finishing step again, delete the run's drafts from batches no longer
 * in the plan: a later topic-map pass can reuse the run, and the plan can
 * shrink mid-run. The last step hands the run to verify.
 */
export const generateHandler: JobHandler = async ({ db, ai, documentId, step, payload }) => {
  const runId = payload.runId;
  if (typeof runId !== "string" || !runId) throw new Error("The generate job has no generation run");

  const plan = await loadGenerationPlan(db, documentId);
  if (step === 0) await deleteStaleDrafts(db, runId, plan);

  const next = { kind: "verify" as const, payload: { runId } };
  const batch = plan[step];
  if (!batch) {
    await deleteStaleDrafts(db, runId, plan);
    return {
      done: true,
      progress: {
        current: plan.length,
        total: plan.length,
        label: plan.length === 0 ? "No topics to write questions for" : "Questions written",
      },
      next,
    };
  }

  const [avoidStems, pageDocs] = await Promise.all([
    loadAvoidStems(db, batch, runId),
    loadPagePhotos(db, batch.slides),
  ]);
  const result = await generateForTopic(
    {
      topicName: batch.topicName,
      slides: batch.slides,
      pageDocs,
      avoidStems,
      contextSlides: batch.otherSlides,
      ...targetsFor(batch.slides.length),
      batchIndex: batch.batchIndex,
    },
    ai,
    documentId,
  );

  const items = [...result.mcqs, ...result.saqs].map((q) => toSaveItem(q, batch, documentId));
  const { error: saveError } = await db.rpc("save_generated_questions", {
    p_run_id: runId,
    p_topic_id: batch.topicId,
    p_batch_key: batch.batchKey,
    p_items: items,
  });
  if (saveError) {
    throw new Error(`Could not save the questions for ${batch.topicName}: ${saveError.message}`);
  }

  const progress = {
    current: step + 1,
    total: plan.length,
    label: `Writing questions: ${batch.topicName} (${step + 1} of ${plan.length})`,
  };
  if (step < plan.length - 1) return { done: false, progress };
  await deleteStaleDrafts(db, runId, plan);
  return { done: true, progress, next };
};
