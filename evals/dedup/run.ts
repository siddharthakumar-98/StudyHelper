/**
 * Live dedup eval: for each pair in pairs.json, inserts the first stem as an
 * active question, runs find_similar_stems + checkDuplicate on the second stem
 * exactly as the verify stage does, then deletes the question. Writes
 * evals/dedup/report.md.
 *
 *   npm run eval:dedup
 *
 * This spends money: one dedup call per pair whose similarity is between 0.45
 * and 0.9 (at most 20 calls, about $0.10). Get approval first.
 *
 * Each pair is checked on its own: candidates other than the pair's first
 * question (for example real bank questions in the same database) are ignored
 * and counted in the report, so pairs never interfere with each other.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createAnthropicAiClient, type AiCallLog } from "@/modules/ai/client";
import { MODEL_CONFIG } from "@/modules/ai/models";
import { DEDUP_PROMPT } from "@/modules/ai/prompts/dedup";
import { checkDuplicate, DUPLICATE_AUTO_THRESHOLD } from "@/modules/generation/verify";

type Stem = { type: "mcq" | "saq"; stem: string };
interface Pair {
  id: string;
  kind: "duplicate" | "distinct";
  fact: string;
  first: Stem;
  second: Stem;
}

const TARGET_CAUGHT = 9;
const TARGET_FALSE_MERGES = 0;
const EVAL_TITLE = "Dedup eval (temporary)";
const PAIRS_PATH = new URL("./pairs.json", import.meta.url);
const REPORT_PATH = new URL("./report.md", import.meta.url);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const pairs = (JSON.parse(readFileSync(PAIRS_PATH, "utf8")) as { pairs: Pair[] }).pairs;

const db = createClient<Database>(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let totalCost = 0;
let aiCalls = 0;
async function logAiCall(row: AiCallLog): Promise<void> {
  totalCost += row.costUsd;
  aiCalls += 1;
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

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data == null) {
    throw new Error(`${what} failed: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

// A document (for ai_calls attribution) and a topic for the eval's questions.
// Both are deleted at the end; the ai_calls rows keep their cost (document_id set null).
const documentId = must(
  await db.from("documents").insert({ title: EVAL_TITLE, status: "ready" }).select("id").single(),
  "Creating the eval document",
).id;
const topicId = must(
  await db.from("topics").insert({ name: `${EVAL_TITLE} ${documentId}` }).select("id").single(),
  "Creating the eval topic",
).id;

async function insertActive(stem: Stem): Promise<string> {
  const id = must(
    await db
      .from("questions")
      .insert({ type: stem.type, status: "active", topic_id: topicId, difficulty: "easy" })
      .select("id")
      .single(),
    "Inserting a question",
  ).id;
  must(
    await db
      .from("question_versions")
      .insert({ question_id: id, version: 1, stem: stem.stem, source_refs: [], basis_quote: "(dedup eval)" })
      .select("question_id")
      .single(),
    "Inserting a question version",
  );
  return id;
}

type Row = {
  pair: Pair;
  sim: number | null;
  path: "no candidate" | "auto (≥ 0.9)" | "model";
  merged: boolean;
  reason: string;
  ignored: number;
};

console.log(`Checking ${pairs.length} pairs live (estimated cost about $0.10)…`);
const rows: Row[] = [];
try {
  for (const pair of pairs) {
    const firstId = await insertActive(pair.first);
    try {
      const found = must(
        await db.rpc("find_similar_stems", {
          p_stem: pair.second.stem,
          // The second question is not in the bank, so nothing needs leaving out.
          p_exclude_question: "00000000-0000-4000-8000-000000000000",
        }),
        "find_similar_stems",
      );
      const candidates = found.filter((c) => c.question_id === firstId);
      const sim = candidates[0]?.sim ?? null;
      const callsBefore = aiCalls;
      const result = await checkDuplicate(
        { id: "dedup-eval-second", stem: pair.second.stem },
        candidates,
        ai,
        documentId,
      );
      rows.push({
        pair,
        sim,
        path:
          candidates.length === 0 ? "no candidate" : aiCalls > callsBefore ? "model" : "auto (≥ 0.9)",
        merged: result.duplicateOf === firstId,
        reason: result.reason,
        ignored: found.length - candidates.length,
      });
      console.log(`  ${pair.id}: sim ${sim?.toFixed(2) ?? "< 0.45"} → ${result.duplicateOf ? "duplicate" : "distinct"}`);
    } finally {
      await db.from("questions").delete().eq("id", firstId);
    }
  }
} finally {
  await db.from("topics").delete().eq("id", topicId);
  await db.from("documents").delete().eq("id", documentId);
}

const duplicates = rows.filter((r) => r.pair.kind === "duplicate");
const distinct = rows.filter((r) => r.pair.kind === "distinct");
const caught = duplicates.filter((r) => r.merged).length;
const falseMerges = distinct.filter((r) => r.merged).length;
const ignored = rows.reduce((n, r) => n + r.ignored, 0);
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const report = [
  "# Dedup eval",
  "",
  `- Run: ${new Date().toISOString()}`,
  `- Prompt: \`${DEDUP_PROMPT.version}\`, model \`${MODEL_CONFIG.dedup.model}\`, effort ${MODEL_CONFIG.dedup.effort}`,
  `- Candidate threshold 0.45 (find_similar_stems); auto-duplicate threshold ${DUPLICATE_AUTO_THRESHOLD}`,
  `- AI calls: ${aiCalls}; cost: $${totalCost.toFixed(4)}`,
  `- Bank questions outside the eval returned and ignored: ${ignored}`,
  "",
  "## Summary",
  "",
  `- Duplicates caught: **${caught}/${duplicates.length}**; target ≥ ${TARGET_CAUGHT}: **${verdict(caught >= TARGET_CAUGHT)}**`,
  `- False merges: **${falseMerges}/${distinct.length}**; target ${TARGET_FALSE_MERGES}: **${verdict(falseMerges <= TARGET_FALSE_MERGES)}**`,
  "",
  "## Per pair",
  "",
  "| Pair | Kind | Similarity | Path | Result | Reason |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => {
    const correct = r.merged === (r.pair.kind === "duplicate");
    return [
      "",
      `\`${r.pair.id}\``,
      r.pair.kind,
      r.sim === null ? "< 0.45" : r.sim.toFixed(2),
      r.path,
      `${r.merged ? "duplicate" : "distinct"} ${correct ? "✓" : "✗"}`,
      cell(r.reason),
      "",
    ]
      .join(" | ")
      .trim();
  }),
  "",
].join("\n");

writeFileSync(REPORT_PATH, report);
console.log(
  `Caught ${caught}/${duplicates.length}, false merges ${falseMerges}/${distinct.length}, cost $${totalCost.toFixed(4)}. Wrote ${REPORT_PATH.pathname}`,
);
