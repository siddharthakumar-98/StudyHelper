export type SlideTable = { caption?: string | null; rows: string[][] };

export type SlideView = {
  id: string;
  pageId: string;
  pageNo: number;
  positionOnPage: number;
  printedSlideNo: string | null;
  title: string | null;
  verbatimText: string;
  tables: SlideTable[];
  diagramDescription: string | null;
  legibility: "clear" | "partial" | "unreadable";
  uncertainTerms: string[];
  cropped: boolean;
  adminCorrected: boolean;
};

export const LEGIBILITY_LABELS: Record<SlideView["legibility"], string> = {
  clear: "Clear",
  partial: "Partly readable",
  unreadable: "Unreadable",
};

export function needsChecking(slide: Pick<SlideView, "legibility" | "uncertainTerms">): boolean {
  return slide.legibility !== "clear" || slide.uncertainTerms.length > 0;
}

export type TextPart = { text: string; uncertain: boolean };

/** Splits slide text so `[?word?]` markers can be highlighted. */
export function splitUncertain(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[\?(.+?)\?\]/g)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), uncertain: false });
    parts.push({ text: match[1], uncertain: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), uncertain: false });
  return parts;
}

/** Reads the jsonb `tables` column defensively. */
export function parseTables(value: unknown): SlideTable[] {
  if (!Array.isArray(value)) return [];
  const tables: SlideTable[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { caption, rows } = item as { caption?: unknown; rows?: unknown };
    if (!Array.isArray(rows)) continue;
    tables.push({
      caption: typeof caption === "string" ? caption : null,
      rows: rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [])),
    });
  }
  return tables;
}
