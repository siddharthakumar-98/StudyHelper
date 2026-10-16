import type Anthropic from "@anthropic-ai/sdk";
import type { AiClient } from "@/modules/ai/client";
import { GENERATE_QUESTIONS_PROMPT } from "@/modules/ai/prompts/generateQuestions";
import { GenerationResultSchema, type GenerationResult } from "@/modules/ai/schemas/generation";

export type SlideForGeneration = {
  id: string;
  label: string;
  pageId: string;
  title: string | null;
  verbatim_text: string;
  tables: unknown[];
  diagram_description: string | null;
};

/** A batch's expected output must stay well under the generate task's max_tokens. */
export const MAX_SLIDES_PER_BATCH = 6;

/** Diagrams described at more length than this are attached as page photos. */
const LONG_DIAGRAM = 200;

/** The most questions a batch of `slideCount` slides may produce. Fewer is fine. */
export function targetsFor(slideCount: number): { maxMcq: number; maxSaq: number } {
  return { maxMcq: Math.ceil(slideCount * 0.9), maxSaq: Math.ceil(slideCount * 0.4) };
}

/** Chunks a topic's slides into batches of at most 6, keeping their order. */
export function planTopicBatches<T extends SlideForGeneration>(slides: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < slides.length; i += MAX_SLIDES_PER_BATCH) {
    batches.push(slides.slice(i, i + MAX_SLIDES_PER_BATCH));
  }
  return batches;
}

/** Table rows as the model sees them and as basis quotes are matched: cells joined by " | ". */
function tableLines(tables: unknown[]): string[] {
  const lines: string[] = [];
  for (const table of tables as { caption?: unknown; rows?: unknown }[]) {
    if (typeof table?.caption === "string" && table.caption.trim()) lines.push(table.caption);
    if (!Array.isArray(table?.rows)) continue;
    for (const row of table.rows) {
      if (Array.isArray(row)) lines.push(row.map(String).join(" | "));
    }
  }
  return lines;
}

/**
 * Everything a basis quote may be copied from: the slide's text, its tables
 * flattened row by row, its diagram description and its title (the model sees
 * all four).
 */
export function slideSourceText(slide: SlideForGeneration): string {
  return [
    slide.verbatim_text,
    ...tableLines(slide.tables),
    slide.diagram_description ?? "",
    slide.title ?? "",
  ]
    .filter((part) => part.trim())
    .join("\n");
}

/** Slides whose page photo is sent along: any table, or a long diagram description. */
export function needsPagePhoto(slide: SlideForGeneration): boolean {
  return (
    (Array.isArray(slide.tables) && slide.tables.length > 0) ||
    (slide.diagram_description?.length ?? 0) > LONG_DIAGRAM
  );
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/** A page's bytes as a content block; the type is read from the file's signature. */
function pageBlock(bytes: Uint8Array): Anthropic.Beta.BetaContentBlockParam {
  const data = Buffer.from(bytes).toString("base64");
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { type: "image", source: { type: "base64", media_type: "image/png", data } };
  }
  throw new Error("A page photo is not a PDF, JPG or PNG");
}

function slideBlock(slide: SlideForGeneration, alias: string): string {
  const lines = [`[${alias}] ${slide.label}`, `Title: ${slide.title ?? "(none)"}`];
  lines.push(`Text:\n${slide.verbatim_text.trim() || "(none)"}`);
  const rows = tableLines(slide.tables);
  if (rows.length > 0) lines.push(`Tables:\n${rows.join("\n")}`);
  if (slide.diagram_description?.trim()) lines.push(`Diagram: ${slide.diagram_description.trim()}`);
  return lines.join("\n");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Writes one batch of a topic's questions. The model sees short slide ids (S1,
 * S2, ...) instead of slide ids; they are mapped back here. An id the model
 * invents stays as it is, so validateGenerated reports it. Page photos are
 * attached, one per page, for slides with tables or long diagram descriptions.
 * Questions beyond the maxima are dropped, never kept.
 */
export async function generateForTopic(
  input: {
    topicName: string;
    slides: SlideForGeneration[];
    /** Page bytes by page id; needed for the pages of slides that get a photo. */
    pageDocs: Map<string, Uint8Array>;
    avoidStems: string[];
    maxMcq: number;
    maxSaq: number;
    /** Not sent to the model; lets the fake AI label its questions. */
    batchIndex?: number;
  },
  ai: AiClient,
  documentId: string,
): Promise<GenerationResult> {
  const aliases = input.slides.map((_, i) => `S${i + 1}`);
  const idOf = new Map(aliases.map((alias, i) => [alias, input.slides[i].id]));
  const back = (alias: string) => idOf.get(alias.trim().toUpperCase()) ?? alias;

  const avoid = input.avoidStems.length
    ? input.avoidStems.map((stem) => `- ${stem.replace(/\s+/g, " ").trim()}`).join("\n")
    : "(none)";
  const text = [
    `Topic: ${input.topicName}`,
    `Write at most ${plural(input.maxMcq, "MCQ")} and at most ${plural(input.maxSaq, "SAQ")}. Fewer is fine.`,
    `avoid_stems:\n${avoid}`,
    `Slides:\n\n${input.slides.map((slide, i) => slideBlock(slide, aliases[i])).join("\n\n")}`,
  ].join("\n\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text }];
  const photoAliases = new Map<string, string[]>();
  input.slides.forEach((slide, i) => {
    if (!needsPagePhoto(slide) || !input.pageDocs.has(slide.pageId)) return;
    photoAliases.set(slide.pageId, [...(photoAliases.get(slide.pageId) ?? []), aliases[i]]);
  });
  for (const [pageId, onPage] of photoAliases) {
    content.push({ type: "text", text: `Page photo for ${onPage.join(", ")}:` });
    content.push(pageBlock(input.pageDocs.get(pageId)!));
  }

  const firstQuoted = input.slides.findIndex((s) => slideSourceText(s).trim());
  const { data } = await ai.callStructured({
    task: "generate",
    promptVersion: GENERATE_QUESTIONS_PROMPT.version,
    system: GENERATE_QUESTIONS_PROMPT.system,
    content,
    schema: GenerationResultSchema,
    documentId,
    // Not sent to the model; lets the fake AI answer with a valid slide id and quote.
    meta: {
      topicName: input.topicName,
      batchIndex: input.batchIndex ?? 0,
      quoteSlide: firstQuoted >= 0 ? aliases[firstQuoted] : "",
      quote:
        firstQuoted >= 0
          ? slideSourceText(input.slides[firstQuoted]).split("\n").find((l) => l.trim())!.trim().slice(0, 200)
          : "",
    },
  });

  const cite = <Q extends { source_slide_ids: string[] }>(q: Q): Q => ({
    ...q,
    source_slide_ids: q.source_slide_ids.map(back),
  });
  if (data.mcqs.length > input.maxMcq || data.saqs.length > input.maxSaq) {
    console.warn(
      `generate: model wrote ${data.mcqs.length} MCQs / ${data.saqs.length} SAQs for "${input.topicName}" (max ${input.maxMcq} / ${input.maxSaq}); extras dropped`,
    );
  }
  return {
    mcqs: data.mcqs.slice(0, input.maxMcq).map(cite),
    saqs: data.saqs.slice(0, input.maxSaq).map(cite),
    skipped_slides: data.skipped_slides.map((s) => ({ ...s, slide_id: back(s.slide_id) })),
  };
}
