import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { AiTruncatedError, aiItemFailureReason, isAiTimeout } from "@/modules/ai/errors";
import type { GeneratedMcq, GeneratedSaq } from "@/modules/ai/schemas/generation";
import { MAX_ATTEMPTS } from "@/modules/jobs/engine";
import type { JobHandler } from "@/modules/jobs/types";
import { slideLabel } from "@/modules/ingestion/slideLabel";
import {
  generateForTopic,
  loadPagePhotos,
  planTopicBatches,
  targetsFor,
  type SlideWithPage,
} from "./generate";
import { buildTopicMap, reconcileTopicMap, slideExcerpt, type TopicMapSlide } from "./topicMap";
import {
  expandSplitBatches,
  isSkippedBatch,
  readRunReport,
  type RunReport,
  type SkippedBatch,
} from "./batchPlan";
import { AUTO_CHECK_PREFIX, isMcq, validateGenerated } from "./validate";
import { markCheckUnfinished, processDraftQuestion } from "./verify";

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

type PlanSlide = SlideWithPage & { positionOnPage: number };

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
 * (topic, batch index), topics ordered by name and slides by page and position,
 * with every batch the run split (report.splitBatches) replaced by its halves.
 * Recomputed from the database on every step, so each step sees the same plan.
 */
async function loadGenerationPlan(db: Db, documentId: string, report: RunReport): Promise<PlanBatch[]> {
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
      const batches = planTopicBatches(ordered).map((slides, batchIndex) => ({
        topicId,
        topicName: topic.name,
        batchIndex,
        batchKey: `${topicId}:${batchIndex}`,
        slides,
        otherSlides: ordered.filter((s) => !slides.includes(s)),
      }));
      return expandSplitBatches(batches, new Set(report.splitBatches), (parent, slides, batchKey) => ({
        ...parent,
        batchKey,
        slides,
        otherSlides: ordered.filter((s) => !slides.includes(s)),
      }));
    });
}

/** The run's report (split keys and skipped batches) with whatever else it holds. */
async function loadRunReport(db: Db, runId: string): Promise<{ raw: Record<string, Json>; report: RunReport }> {
  const { data, error } = await db.from("generation_runs").select("report").eq("id", runId).maybeSingle();
  if (error) throw new Error(`Could not read the generation run: ${error.message}`);
  if (!data) throw new Error("The generation run was not found");
  const raw =
    data.report && typeof data.report === "object" && !Array.isArray(data.report)
      ? (data.report as Record<string, Json>)
      : {};
  return { raw, report: readRunReport(data.report) };
}

/** Rewrites the run's split keys and skipped batches, keeping the rest of the report. */
async function saveRunReport(
  db: Db,
  runId: string,
  change: (report: RunReport) => RunReport,
): Promise<void> {
  const { raw, report } = await loadRunReport(db, runId);
  const next = change(report);
  const { error } = await db
    .from("generation_runs")
    .update({ report: { ...raw, ...next } as unknown as Json })
    .eq("id", runId);
  if (error) throw new Error(`Could not update the generation run: ${error.message}`);
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
 *
 * One bad batch never blocks the handout (R37): a batch of several slides whose
 * answer is cut off or times out (or that keeps failing until the job's last
 * attempt) is split in half and the same step runs again on the first half; a
 * single slide that still fails on the last attempt is skipped and recorded in
 * the run's report, which the coverage report shows.
 */
export const generateHandler: JobHandler = async ({ db, ai, documentId, step, attempt, payload }) => {
  const runId = payload.runId;
  if (typeof runId !== "string" || !runId) throw new Error("The generate job has no generation run");

  const { report } = await loadRunReport(db, runId);
  const plan = await loadGenerationPlan(db, documentId, report);
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

  const progress = {
    current: step + 1,
    total: plan.length,
    label: `Writing questions: ${batch.topicName} (${step + 1} of ${plan.length})`,
  };
  const finish = async () => {
    if (step < plan.length - 1) return { done: false as const, progress };
    await deleteStaleDrafts(db, runId, plan);
    return { done: true as const, progress, next };
  };
  const slideIds = batch.slides.map((s) => s.id);
  if (isSkippedBatch(report.skippedBatches, batch.batchKey, slideIds)) return finish();

  const [avoidStems, pageDocs] = await Promise.all([
    loadAvoidStems(db, batch, runId),
    loadPagePhotos(db, batch.slides),
  ]);
  let result: Awaited<ReturnType<typeof generateForTopic>>;
  try {
    result = await generateForTopic(
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
  } catch (err) {
    const reason = aiItemFailureReason(err);
    const lastAttempt = attempt >= MAX_ATTEMPTS;
    if (reason === null) throw err;
    if (batch.slides.length > 1 && (err instanceof AiTruncatedError || isAiTimeout(err) || lastAttempt)) {
      await saveRunReport(db, runId, (r) => ({
        ...r,
        splitBatches: r.splitBatches.includes(batch.batchKey)
          ? r.splitBatches
          : [...r.splitBatches, batch.batchKey],
      }));
      return {
        done: false,
        repeatStep: true,
        progress: {
          current: step,
          total: plan.length + 1,
          label: `Writing questions: ${batch.topicName} (trying fewer slides at a time)`,
        },
      };
    }
    if (!lastAttempt) throw err;
    const skipped: SkippedBatch = {
      batchKey: batch.batchKey,
      slideIds,
      slideLabels: batch.slides.map((s) => s.label),
      reason,
    };
    await saveRunReport(db, runId, (r) => ({
      ...r,
      skippedBatches: [
        ...r.skippedBatches.filter((s) => s.batchKey !== batch.batchKey),
        skipped,
      ],
    }));
    // Clear any drafts an earlier pass wrote for this batch (replace, not append).
    await saveBatch(db, runId, batch, []);
    console.warn(`generate: skipped ${batch.batchKey} of run ${runId}: ${reason}`);
    return finish();
  }

  const items = [...result.mcqs, ...result.saqs].map((q) => toSaveItem(q, batch, documentId));
  await saveBatch(db, runId, batch, items);
  return finish();
};

async function saveBatch(db: Db, runId: string, batch: PlanBatch, items: Record<string, Json>[]): Promise<void> {
  const { error } = await db.rpc("save_generated_questions", {
    p_run_id: runId,
    p_topic_id: batch.topicId,
    p_batch_key: batch.batchKey,
    p_items: items,
  });
  if (error) {
    throw new Error(`Could not save the questions for ${batch.topicName}: ${error.message}`);
  }
}

/** Most draft questions one verify step checks. */
export const VERIFY_BATCH_SIZE = 5;

/**
 * A verify step starts another draft only while it has run less than this. One
 * question can take a dedup call and a verifier call, so starting late would
 * push the step past the 300 s route limit; a killed step is retried and counts
 * an attempt. Each question's outcome is saved as soon as it is checked, so
 * stopping early loses nothing: the next step continues with the next draft.
 */
export const VERIFY_START_WINDOW_MS = 60_000;

async function countRunQuestions(db: Db, runId: string, draftsOnly: boolean): Promise<number> {
  let query = db.from("questions").select("id", { count: "exact", head: true }).eq("generation_run_id", runId);
  if (draftsOnly) query = query.eq("status", "draft");
  const { count, error } = await query;
  if (error || count === null) {
    throw new Error(`Could not count the run's questions: ${error?.message ?? "no count"}`);
  }
  return count;
}

/**
 * Each step checks up to 5 of the run's draft questions, oldest first, starting
 * a new one only within VERIFY_START_WINDOW_MS of the step's start
 * (processDraftQuestion: pre-check notes, duplicates, then the independent
 * verifier). When no drafts remain, the run is completed and the handout is
 * ready. Safe to re-run: only drafts are processed. On the job's last attempt a
 * draft whose check the AI cannot finish goes to review instead (R37).
 */
export const verifyHandler: JobHandler = async ({ db, ai, documentId, attempt, payload }) => {
  const runId = payload.runId;
  if (typeof runId !== "string" || !runId) throw new Error("The verify job has no generation run");

  const { data: drafts, error } = await db
    .from("questions")
    .select("id")
    .eq("generation_run_id", runId)
    .eq("status", "draft")
    .order("created_at")
    .order("id")
    .limit(VERIFY_BATCH_SIZE);
  if (error) throw new Error(`Could not read the questions to check: ${error.message}`);

  const started = Date.now();
  for (const draft of drafts) {
    if (Date.now() - started >= VERIFY_START_WINDOW_MS) break;
    try {
      await processDraftQuestion(draft.id, { db, ai, documentId });
    } catch (err) {
      // R37: earlier attempts retry the step as usual. On the last one, a draft the
      // AI keeps failing on goes to the review queue and the others carry on.
      const reason = aiItemFailureReason(err);
      if (reason === null || attempt < MAX_ATTEMPTS) throw err;
      console.warn(`verify: question ${draft.id} set aside for review: ${reason}`);
      await markCheckUnfinished(db, draft.id, reason);
    }
  }

  const [total, remaining] = await Promise.all([
    countRunQuestions(db, runId, false),
    countRunQuestions(db, runId, true),
  ]);
  const progress = {
    current: total - remaining,
    total,
    label: `Checking questions (${total - remaining} of ${total})`,
  };
  if (remaining > 0) return { done: false, progress };

  const { error: runError } = await db
    .from("generation_runs")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", runId)
    .is("completed_at", null);
  if (runError) throw new Error(`Could not complete the generation run: ${runError.message}`);
  const { error: docError } = await db.from("documents").update({ status: "ready" }).eq("id", documentId);
  if (docError) throw new Error(`Could not mark the handout ready: ${docError.message}`);
  return { done: true, progress };
};
