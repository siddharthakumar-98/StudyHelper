/**
 * Live dedup eval: for each pair in pairs.json, inserts the first question (stem
 * and answer) as an active question, runs find_similar_stems + checkDuplicate on
 * the second exactly as the verify stage does, then deletes the question.
 * Writes evals/dedup/report.md, also when pairs or the whole run fail.
 *
 *   npm run eval:dedup
 *
 * This spends money: one dedup call per pair that is a candidate but not an
 * automatic duplicate (at most 20 calls, about $0.10). Get approval first.
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
import {
  checkDuplicate,
  DUPLICATE_AUTO_THRESHOLD,
  SIMILAR_STEM_THRESHOLD,
  toSimilarStems,
} from "@/modules/generation/verify";

type Question = { type: "mcq" | "saq"; stem: string; answer: string };
interface Pair {
  id: string;
  kind: "duplicate" | "distinct";
  fact: string;
  first: Question;
  second: Question;
}

const TARGET_CAUGHT = 9;
const TARGET_FALSE_MERGES = 0;
const EVAL_TITLE = "Dedup eval (temporary)";
const PAIRS_PATH = new URL("./pairs.json", import.meta.url);
const REPORT_PATH = new URL("./report.md", import.meta.url);

const PATH_NONE = `no candidate (< ${SIMILAR_STEM_THRESHOLD})`;
const PATH_AUTO = `auto (≥ ${DUPLICATE_AUTO_THRESHOLD}, same type and answer)`;
const PATH_MODEL = "model";

type Row = {
  pair: Pair;
  sim: number | null;
  path: string;
  merged: boolean;
  reason: string;
  ignored: number;
  error: string | null;
};

const rows: Row[] = [];
let fatal: string | null = null;
let totalCost = 0;
let aiCalls = 0;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data == null) {
    throw new Error(`${what} failed: ${result.error?.message ?? "no data"}`);
  }
  return result.data;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function run(): Promise<void> {
  const pairs = (JSON.parse(readFileSync(PAIRS_PATH, "utf8")) as { pairs: Pair[] }).pairs;

  const db = createClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

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

  // A document (for ai_calls attribution) and a topic for the eval's questions.
  // Both are deleted at the end; the ai_calls rows keep their cost (document_id set null).
  const documentId = must(
    await db.from("documents").insert({ title: EVAL_TITLE, status: "ready" }).select("id").single(),
    "Creating the eval document",
  ).id;
  let topicId: string | null = null;

  async function insertActive(q: Question): Promise<string> {
    const id = must(
      await db
        .from("questions")
        .insert({ type: q.type, status: "active", topic_id: topicId!, difficulty: "easy" })
        .select("id")
        .single(),
      "Inserting a question",
    ).id;
    must(
      await db
        .from("question_versions")
        .insert({
          question_id: id,
          version: 1,
          stem: q.stem,
          options: q.type === "mcq" ? [{ id: "a", text: q.answer }] : null,
          source_refs: [],
          basis_quote: "(dedup eval)",
        })
        .select("question_id")
        .single(),
      "Inserting a question version",
    );
    must(
      await db
        .from("answer_keys")
        .insert({
          question_id: id,
          version: 1,
          correct_option_id: q.type === "mcq" ? "a" : null,
          model_answer: q.type === "saq" ? q.answer : null,
        })
        .select("question_id")
        .single(),
      "Inserting an answer key",
    );
    return id;
  }

  try {
    topicId = must(
      await db.from("topics").insert({ name: `${EVAL_TITLE} ${documentId}` }).select("id").single(),
      "Creating the eval topic",
    ).id;
    console.log(`Checking ${pairs.length} pairs live (estimated cost about $0.10)…`);
    for (const pair of pairs) {
      let firstId: string | null = null;
      try {
        firstId = await insertActive(pair.first);
        const found = toSimilarStems(
          must(
            await db.rpc("find_similar_stems", {
              p_stem: pair.second.stem,
              // The second question is not in the bank, so nothing needs leaving out.
              p_exclude_question: "00000000-0000-4000-8000-000000000000",
              p_threshold: SIMILAR_STEM_THRESHOLD,
            }),
            "find_similar_stems",
          ),
        );
        const candidates = found.filter((c) => c.question_id === firstId);
        const callsBefore = aiCalls;
        const result = await checkDuplicate(
          { id: "dedup-eval-second", ...pair.second },
          candidates,
          ai,
          documentId,
        );
        rows.push({
          pair,
          sim: candidates[0]?.sim ?? null,
          path: candidates.length === 0 ? PATH_NONE : aiCalls > callsBefore ? PATH_MODEL : PATH_AUTO,
          merged: result.duplicateOf === firstId,
          reason: result.reason,
          ignored: found.length - candidates.length,
          error: null,
        });
        console.log(`  ${pair.id}: ${result.duplicateOf ? "duplicate" : "distinct"}`);
      } catch (err) {
        rows.push({ pair, sim: null, path: "error", merged: false, reason: "", ignored: 0, error: message(err) });
        console.error(`  ${pair.id}: error: ${message(err)}`);
      } finally {
        if (firstId) await db.from("questions").delete().eq("id", firstId);
      }
    }
  } finally {
    if (topicId) await db.from("topics").delete().eq("id", topicId);
    await db.from("documents").delete().eq("id", documentId);
  }
}

function writeReport(): void {
  const ok = rows.filter((r) => !r.error);
  const duplicates = ok.filter((r) => r.pair.kind === "duplicate");
  const distinct = ok.filter((r) => r.pair.kind === "distinct");
  const caught = duplicates.filter((r) => r.merged).length;
  const falseMerges = distinct.filter((r) => r.merged).length;
  const errors = rows.length - ok.length;
  const complete = fatal === null && errors === 0;
  const verdict = (pass: boolean) => (!complete ? "INCOMPLETE" : pass ? "PASS" : "FAIL");
  const ignored = rows.reduce((n, r) => n + r.ignored, 0);
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

  const report = [
    "# Dedup eval",
    "",
    `- Run: ${new Date().toISOString()}`,
    `- Prompt: \`${DEDUP_PROMPT.version}\`, model \`${MODEL_CONFIG.dedup.model}\`, effort ${MODEL_CONFIG.dedup.effort}`,
    `- Candidate threshold ${SIMILAR_STEM_THRESHOLD} (find_similar_stems); automatic duplicate: similarity ≥ ${DUPLICATE_AUTO_THRESHOLD} with the same type and answer`,
    `- AI calls: ${aiCalls}; cost: $${totalCost.toFixed(4)}`,
    `- Bank questions outside the eval returned and ignored: ${ignored}`,
    ...(fatal ? [`- **Run failed:** ${cell(fatal)}`] : []),
    `- Pairs with errors: ${errors}`,
    "",
    "## Summary",
    "",
    `- Duplicates caught: **${caught}/${duplicates.length}**; target ≥ ${TARGET_CAUGHT}: **${verdict(caught >= TARGET_CAUGHT)}**`,
    `- False merges: **${falseMerges}/${distinct.length}**; target ${TARGET_FALSE_MERGES}: **${verdict(falseMerges <= TARGET_FALSE_MERGES)}**`,
    "",
    "## Per pair",
    "",
    "| Pair | Kind | Similarity | Path | Result | Reason or error |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => {
      const correct = r.merged === (r.pair.kind === "duplicate");
      return [
        "",
        `\`${r.pair.id}\``,
        r.pair.kind,
        r.sim === null ? "-" : r.sim.toFixed(2),
        r.path,
        r.error ? "error ✗" : `${r.merged ? "duplicate" : "distinct"} ${correct ? "✓" : "✗"}`,
        cell(r.error ?? r.reason),
        "",
      ]
        .join(" | ")
        .trim();
    }),
    "",
  ].join("\n");

  writeFileSync(REPORT_PATH, report);
  console.log(
    `Caught ${caught}/${duplicates.length}, false merges ${falseMerges}/${distinct.length}, errors ${errors}, cost $${totalCost.toFixed(4)}. Wrote ${REPORT_PATH.pathname}`,
  );
}

try {
  await run();
} catch (err) {
  fatal = message(err);
  console.error(`Dedup eval failed: ${fatal}`);
  process.exitCode = 1;
} finally {
  writeReport();
}
