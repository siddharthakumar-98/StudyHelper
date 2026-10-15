/**
 * Live extraction eval: runs extractPage on the gold pages of an already-split
 * handout and writes evals/extraction/report.md.
 *
 *   npm run eval:extraction -- <documentId>
 *
 * This spends money (about $0.40 for the 10 gold pages). Get approval first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { containsNormalized } from "@/lib/text";
import { createAnthropicAiClient, type AiCallLog } from "@/modules/ai/client";
import { MODEL_CONFIG } from "@/modules/ai/models";
import { EXTRACT_SLIDES_PROMPT } from "@/modules/ai/prompts/extractSlides";
import type { ExtractedSlide } from "@/modules/ai/schemas/extraction";
import { extractPage } from "@/modules/ingestion/extractSlides";
import { MATERIALS_BUCKET, pageMime } from "@/modules/ingestion/paths";

type Legibility = ExtractedSlide["legibility"];

interface GoldSlide {
  slide?: string;
  page_no: number;
  position_on_page: number;
  expected_legibility: Legibility;
  critical_tokens: string[];
}

const TARGET_RECALL = 0.98;
const GOLD_PATH = new URL("./gold.json", import.meta.url);
const REPORT_PATH = new URL("./report.md", import.meta.url);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const documentId = process.argv[2];
if (!documentId) {
  console.error("Usage: npm run eval:extraction -- <documentId>");
  process.exit(1);
}

const gold = (JSON.parse(readFileSync(GOLD_PATH, "utf8")) as { slides: GoldSlide[] }).slides;

const db = createClient<Database>(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let totalCost = 0;
async function logAiCall(row: AiCallLog): Promise<void> {
  totalCost += row.costUsd;
  const { error } = await db.from("ai_calls").insert({
    task: row.task,
    model: row.model,
    prompt_version: row.promptVersion,
    input_tokens: row.usage.input,
    output_tokens: row.usage.output,
    cache_read_tokens: row.usage.cacheRead,
    cache_write_tokens: row.usage.cacheWrite,
    cost_usd: row.costUsd,
    document_id: row.documentId ?? null,
  });
  if (error) throw new Error(`ai_calls insert failed: ${error.message}`);
}

const ai = createAnthropicAiClient(
  new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 2, timeout: 270_000 }),
  logAiCall,
);

/** Everything the extraction produced for a slide, as one searchable string. */
function slideText(slide: ExtractedSlide): string {
  return [
    slide.title,
    slide.verbatim_text,
    ...slide.tables.flatMap((t) => [t.caption, ...t.rows.map((row) => row.join(" "))]),
    slide.diagram_description,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function legibilityAgrees(expected: Legibility, got: Legibility | undefined): boolean {
  if (!got) return false;
  return expected === "unreadable" ? got !== "clear" : got === expected;
}

const pageNos = [...new Set(gold.map((g) => g.page_no))].sort((a, b) => a - b);
console.log(`Extracting ${pageNos.length} gold pages live (estimated cost about $0.40)…`);

const extracted = new Map<number, ExtractedSlide[]>();
for (const pageNo of pageNos) {
  const { data: page, error } = await db
    .from("source_pages")
    .select("kind, storage_path")
    .eq("document_id", documentId)
    .eq("page_no", pageNo)
    .single();
  if (error || !page) throw new Error(`Page ${pageNo} not found: ${error?.message ?? "missing"}`);
  const mime = pageMime(page.storage_path);
  if (!mime) throw new Error(`Page ${pageNo} has an unknown file type`);
  const { data: blob, error: downloadError } = await db.storage
    .from(MATERIALS_BUCKET)
    .download(page.storage_path);
  if (downloadError || !blob) {
    throw new Error(`Could not download page ${pageNo}: ${downloadError?.message ?? "missing"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  extracted.set(
    pageNo,
    await extractPage({ kind: page.kind, storagePath: page.storage_path, mime }, bytes, ai, documentId),
  );
  console.log(`  page ${pageNo}: ${extracted.get(pageNo)!.length} slide(s)`);
}

const rows = gold.map((g) => {
  const slide = extracted.get(g.page_no)?.find((s) => s.position_on_page === g.position_on_page);
  const text = slide ? slideText(slide) : "";
  const missing = g.critical_tokens.filter((token) => !containsNormalized(text, token));
  return {
    gold: g,
    got: slide?.legibility,
    found: g.critical_tokens.length - missing.length,
    missing,
    legibilityOk: legibilityAgrees(g.expected_legibility, slide?.legibility),
  };
});

const clear = rows.filter((r) => r.gold.expected_legibility === "clear");
const clearTotal = clear.reduce((n, r) => n + r.gold.critical_tokens.length, 0);
const clearFound = clear.reduce((n, r) => n + r.found, 0);
const recall = clearTotal === 0 ? 1 : clearFound / clearTotal;
const legibilityOk = rows.filter((r) => r.legibilityOk).length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const report = [
  "# Extraction eval",
  "",
  `- Run: ${new Date().toISOString()}`,
  `- Document: \`${documentId}\``,
  `- Prompt: \`${EXTRACT_SLIDES_PROMPT.version}\`, model \`${MODEL_CONFIG.extract.model}\``,
  `- Cost: $${totalCost.toFixed(4)}`,
  "",
  "## Summary",
  "",
  `- Critical-token recall on gold-clear slides: **${pct(recall)}** (${clearFound}/${clearTotal}); ` +
    `target ≥ ${pct(TARGET_RECALL)}: **${recall >= TARGET_RECALL ? "PASS" : "FAIL"}**`,
  `- Legibility agreement: **${legibilityOk}/${rows.length}** ` +
    "(gold `unreadable` passes when the extraction is not `clear`)",
  "",
  "## Per slide",
  "",
  "| Page | Photo | Slide | Legibility (gold → got) | Recall | Missing tokens |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => {
    const n = r.gold.critical_tokens.length;
    return [
      "",
      r.gold.page_no,
      r.gold.position_on_page,
      cell(r.gold.slide ?? ""),
      `${r.gold.expected_legibility} → ${r.got ?? "missing"} ${r.legibilityOk ? "✓" : "✗"}`,
      n === 0 ? "n/a" : `${r.found}/${n}`,
      cell(r.missing.map((t) => `\`${t}\``).join(", ")),
      "",
    ].join(" | ").trim();
  }),
  "",
].join("\n");

writeFileSync(REPORT_PATH, report);
console.log(`Recall ${pct(recall)}, legibility ${legibilityOk}/${rows.length}. Wrote ${REPORT_PATH.pathname}`);
