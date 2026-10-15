import type Anthropic from "@anthropic-ai/sdk";
import type { AiClient } from "@/modules/ai/client";
import { EXTRACT_SLIDES_PROMPT } from "@/modules/ai/prompts/extractSlides";
import { ExtractionResultSchema, type ExtractedSlide } from "@/modules/ai/schemas/extraction";

export type ExtractablePage = {
  kind: "pdf_page" | "image";
  storagePath: string;
  mime: string;
  /** Not sent to the model; lets the fake AI answer per page. */
  pageNo?: number;
};

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function pageBlock(page: ExtractablePage, data: string): Anthropic.Beta.BetaContentBlockParam {
  if (page.kind === "pdf_page") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (!IMAGE_MEDIA_TYPES.includes(page.mime as ImageMediaType)) {
    throw new Error(`Page ${page.storagePath} is not a JPG or PNG image`);
  }
  return {
    type: "image",
    source: { type: "base64", media_type: page.mime as ImageMediaType, data },
  };
}

/**
 * Transcribes every slide photo on one page with Claude vision. Positions are
 * renumbered 1..n in the model's top-to-bottom order, so two photos can never
 * share a position even if the model repeats one.
 */
export async function extractPage(
  page: ExtractablePage,
  bytes: Uint8Array,
  ai: AiClient,
  documentId: string,
): Promise<ExtractedSlide[]> {
  const data = Buffer.from(bytes).toString("base64");
  const { data: result } = await ai.callStructured({
    task: "extract",
    promptVersion: EXTRACT_SLIDES_PROMPT.version,
    system: EXTRACT_SLIDES_PROMPT.system,
    content: [pageBlock(page, data), { type: "text", text: "Extract every slide on this page." }],
    schema: ExtractionResultSchema,
    documentId,
    meta: page.pageNo === undefined ? undefined : { pageNo: page.pageNo },
  });
  return [...result.slides]
    .sort((a, b) => a.position_on_page - b.position_on_page)
    .map((slide, i) => ({ ...slide, position_on_page: i + 1 }));
}
