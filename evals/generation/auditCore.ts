/**
 * Pure parts of the generation audit: seeded sampling and Markdown rendering.
 * No database, no network, no AI, so they are unit tested
 * (tests/unit/evals/auditCore.test.ts).
 */
import type { Rubric } from "@/modules/ai/schemas/generation";
import { slideHeading } from "@/modules/ingestion/slideLabel";

export const SAMPLE_FRACTION = 0.2;
export const DEFAULT_SEED = 20261015;

export const CHECKLIST_COLUMNS = [
  "Supported by slide",
  "Single best answer / rubric sound",
  "Unambiguous",
  "Difficulty right",
  "Source correct",
  "Notes",
] as const;

export interface AuditQuestion {
  id: string;
  type: "mcq" | "saq" | "essay";
  difficulty: string;
  topic: string;
  stem: string;
  options: { id: string; text: string }[] | null;
  correctOptionId: string | null;
  explanation: string | null;
  modelAnswer: string | null;
  rubric: Rubric | null;
  /** Stored source references: the label as saved ("Slide 42") and its page. */
  sourceRefs: { label: string; pageNo: number }[];
  basisQuote: string;
  conflictNote: string | null;
}

/** 20% of the total, rounded to the nearest whole question, never fewer than 1 (0 when there are none). */
export function sampleSize(total: number): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(1, Math.round(total * SAMPLE_FRACTION)));
}

/** A small deterministic generator (mulberry32): the same seed gives the same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A seeded random sample of 20% of the items. Items are put in a fixed order
 * first (by `key`), so the result depends only on the seed and the set of
 * items, not on the order the database returned them. The sample comes back in
 * that fixed order.
 */
export function sampleItems<T>(items: readonly T[], seed: number, key: (item: T) => string): T[] {
  const ordered = [...items].sort((a, b) => key(a).localeCompare(key(b)));
  const random = seededRandom(seed);
  const picked = new Set<number>();
  const want = sampleSize(ordered.length);
  // Partial Fisher-Yates over the indexes.
  const indexes = ordered.map((_, i) => i);
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
    picked.add(indexes[i]);
  }
  return ordered.filter((_, i) => picked.has(i));
}

/** "Slide 42 · page 14" from a stored reference (its label is slideLabel's "Slide 42" or "Page 2, photo 3"). */
export function refHeading(ref: { label: string; pageNo: number }): string {
  const printed = /^Slide (.+)$/.exec(ref.label)?.[1] ?? null;
  const photo = /^Page \d+, photo (\d+)$/.exec(ref.label)?.[1];
  if (printed === null && photo === undefined) return ref.label;
  return slideHeading({
    printed_slide_no: printed,
    page_no: ref.pageNo,
    position_on_page: photo === undefined ? 1 : Number(photo),
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const quote = (s: string) =>
  s
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");

function renderRubric(rubric: Rubric): string[] {
  const lines = ["**Rubric**", ""];
  for (const c of rubric.criteria) {
    lines.push(`- ${c.id} (${c.weight} marks): ${c.statement}`);
  }
  for (const e of rubric.critical_errors) {
    lines.push(`- Critical error ${e.id}: ${e.statement}`);
  }
  return lines;
}

export function renderQuestion(q: AuditQuestion, index: number): string {
  const lines: string[] = [
    `### ${index}. ${q.type.toUpperCase()} · ${q.difficulty} · ${q.topic}`,
    "",
    `Question id: \`${q.id}\``,
    "",
    "**Stem**",
    "",
    quote(q.stem),
    "",
  ];

  if (q.type === "mcq" && q.options) {
    lines.push("**Options** (the correct one is marked)", "");
    for (const o of q.options) {
      lines.push(`- ${o.id === q.correctOptionId ? "**[CORRECT]**" : "[ ]"} ${o.id.toUpperCase()}. ${o.text}`);
    }
    if (q.explanation) lines.push("", `Explanation: ${q.explanation}`);
    lines.push("");
  } else {
    lines.push("**Model answer**", "", quote(q.modelAnswer ?? "(none)"), "");
    if (q.rubric) lines.push(...renderRubric(q.rubric), "");
  }

  const sources = q.sourceRefs.map(refHeading);
  lines.push(
    `**Source**: ${sources.length > 0 ? sources.join("; ") : "(none)"}`,
    "",
    "**Basis quote**",
    "",
    quote(q.basisQuote || "(none)"),
    "",
    `**Conflict note**: ${q.conflictNote?.trim() ? q.conflictNote : "none"}`,
    "",
    `| ${CHECKLIST_COLUMNS.join(" | ")} |`,
    `| ${CHECKLIST_COLUMNS.map(() => "---").join(" | ")} |`,
    `| ${CHECKLIST_COLUMNS.map(() => " ").join(" | ")} |`,
    "",
  );
  return lines.join("\n");
}

export function renderAudit(args: {
  documentId: string;
  documentTitle: string;
  date: string;
  seed: number;
  activeTotal: number;
  sample: AuditQuestion[];
}): string {
  const { documentId, documentTitle, date, seed, activeTotal, sample } = args;
  return [
    `# Generation audit ${date}`,
    "",
    "Admin only: this file marks the correct answers.",
    "",
    `- Document: ${cell(documentTitle)} (\`${documentId}\`)`,
    `- Seed: ${seed}`,
    `- Sample: ${sample.length} of ${activeTotal} active questions (20%, at least 1)`,
    "",
    "## How to fill it in",
    "",
    "For each question, check the slide photo it cites and put a tick or a cross in each column. " +
      "Write what is wrong in Notes. Target: at least 90% of audited questions pass every column, " +
      "with zero unsupported facts. Fix or reject failed questions in the Question Bank, " +
      "then commit this file.",
    "",
    "## Questions",
    "",
    ...(sample.length === 0
      ? ["No active questions for this document yet.", ""]
      : sample.map((q, i) => renderQuestion(q, i + 1))),
  ].join("\n");
}
