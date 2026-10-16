import type { AiClient } from "@/modules/ai/client";
import { TOPIC_MAP_PROMPT } from "@/modules/ai/prompts/topicMap";
import { TopicMapSchema, type TopicMap } from "@/modules/ai/schemas/topicMap";

export type { TopicMap };

export type TopicMapSlide = {
  id: string;
  label: string;
  title: string | null;
  /** First 300 characters of the slide's content. */
  text: string;
  legibility: "clear" | "partial" | "unreadable";
};

const EXCERPT_LENGTH = 300;
/** Below this the slide's own text says little, so tables and the diagram help. */
const SHORT_TEXT = 60;

type ExcerptSource = {
  verbatim_text: string;
  tables: unknown;
  diagram_description: string | null;
};

/** What the topic mapper reads of a slide: its text, plus tables and diagram when the text is short. */
export function slideExcerpt(slide: ExcerptSource): string {
  const parts = [slide.verbatim_text.trim()];
  if (parts[0].length < SHORT_TEXT) {
    if (Array.isArray(slide.tables)) {
      for (const table of slide.tables as { rows?: unknown }[]) {
        if (!Array.isArray(table?.rows)) continue;
        for (const row of table.rows) {
          if (Array.isArray(row)) parts.push(row.join(" | "));
        }
      }
    }
    if (slide.diagram_description) parts.push(slide.diagram_description.trim());
  }
  return parts.filter(Boolean).join("\n").slice(0, EXCERPT_LENGTH);
}

function slideBlock(slide: TopicMapSlide): string {
  return [
    `id: ${slide.id}`,
    `label: ${slide.label}`,
    `title: ${slide.title ?? "(none)"}`,
    `legibility: ${slide.legibility}`,
    `text: ${slide.text.replace(/\s*\n\s*/g, " / ") || "(none)"}`,
  ].join("\n");
}

/** Asks the model to group a handout's slides into topics, reusing existing topic names. */
export async function buildTopicMap(
  slides: TopicMapSlide[],
  existingTopicNames: string[],
  ai: AiClient,
  documentId: string,
): Promise<TopicMap> {
  const existing = existingTopicNames.length
    ? existingTopicNames.map((name) => `- ${name}`).join("\n")
    : "(none yet)";
  const text = `Existing topic names:\n${existing}\n\nSlides:\n\n${slides.map(slideBlock).join("\n\n")}`;
  const { data } = await ai.callStructured({
    task: "topicMap",
    promptVersion: TOPIC_MAP_PROMPT.version,
    system: TOPIC_MAP_PROMPT.system,
    content: [{ type: "text", text }],
    schema: TopicMapSchema,
    documentId,
    // Not sent to the model; lets the fake AI answer with valid slide ids.
    meta: {
      slideIds: slides.map((s) => s.id).join(","),
      readableSlideIds: slides
        .filter((s) => s.legibility !== "unreadable")
        .map((s) => s.id)
        .join(","),
    },
  });
  return data;
}

export type ReconciledTopicMap = {
  topics: { name: string; slideIds: string[] }[];
  unassigned: { slideId: string; reason: string }[];
  droppedIds: string[];
};

const MAX_TOPICS_PER_SLIDE = 2;

/**
 * Makes the model's answer safe to save: unknown ids are dropped (and reported),
 * topics with the same name (ignoring case) are merged, a slide keeps only its
 * first 2 topics, empty topics go, and every readable slide the model forgot is
 * listed as unassigned.
 */
export function reconcileTopicMap(
  map: TopicMap,
  allSlideIds: string[],
  readableSlideIds: string[],
): ReconciledTopicMap {
  const known = new Set(allSlideIds);
  const dropped = new Set<string>();

  const merged = new Map<string, { name: string; slideIds: string[] }>();
  for (const topic of map.topics) {
    const name = topic.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = merged.get(key) ?? { name, slideIds: [] };
    merged.set(key, entry);
    for (const id of topic.slide_ids) {
      if (!known.has(id)) dropped.add(id);
      else if (!entry.slideIds.includes(id)) entry.slideIds.push(id);
    }
  }

  const topicCount = new Map<string, number>();
  const topics: ReconciledTopicMap["topics"] = [];
  for (const entry of merged.values()) {
    const slideIds = entry.slideIds.filter((id) => {
      const used = topicCount.get(id) ?? 0;
      if (used >= MAX_TOPICS_PER_SLIDE) return false;
      topicCount.set(id, used + 1);
      return true;
    });
    if (slideIds.length > 0) topics.push({ name: entry.name, slideIds });
  }

  const unassigned: ReconciledTopicMap["unassigned"] = [];
  const listed = new Set<string>();
  for (const item of map.unassigned) {
    if (!known.has(item.slide_id)) dropped.add(item.slide_id);
    else if (!topicCount.has(item.slide_id) && !listed.has(item.slide_id)) {
      listed.add(item.slide_id);
      unassigned.push({ slideId: item.slide_id, reason: item.reason });
    }
  }
  for (const id of readableSlideIds) {
    if (!topicCount.has(id) && !listed.has(id)) {
      listed.add(id);
      unassigned.push({ slideId: id, reason: "not assigned by model" });
    }
  }

  return { topics, unassigned, droppedIds: [...dropped] };
}
