/**
 * Generation audit sample: writes evals/generation/audit-<YYYY-MM-DD>.md with a
 * seeded random 20% (at least 1) of a document's active questions, each with a
 * checklist for the developer to fill in by hand against the slide photos.
 *
 *   npm run eval:audit-sample -- <documentId> [--seed <n>]
 *
 * Makes no AI calls and costs nothing. Reads the database with the service-role
 * key, so the output contains answer keys: keep it admin-only.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { RubricSchema } from "@/modules/ai/schemas/generation";
import {
  DEFAULT_SEED,
  renderAudit,
  sampleItems,
  type AuditQuestion,
} from "./auditCore";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function parseArgs(argv: string[]): { documentId: string; seed: number } {
  let documentId: string | undefined;
  let seed = DEFAULT_SEED;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed" || arg.startsWith("--seed=")) {
      const raw = arg === "--seed" ? argv[++i] : arg.slice("--seed=".length);
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`--seed needs a whole number, got "${raw}"`);
      seed = n;
    } else if (!arg.startsWith("--") && !documentId) {
      documentId = arg;
    }
  }
  if (!documentId) throw new Error("Usage: npm run eval:audit-sample -- <documentId> [--seed <n>]");
  return { documentId, seed };
}

type Row = {
  id: string;
  type: "mcq" | "saq" | "essay";
  difficulty: string;
  current_version: number;
  topics: { name: string };
  question_versions: {
    version: number;
    stem: string;
    options: Json | null;
    source_refs: Json;
    basis_quote: string;
    conflict_note: string | null;
    answer_keys: {
      correct_option_id: string | null;
      explanation: string | null;
      model_answer: string | null;
      rubric: Json | null;
    } | null;
  }[];
};

function parseOptions(value: Json | null): AuditQuestion["options"] {
  if (!Array.isArray(value)) return null;
  return value.flatMap((o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return [];
    return typeof o.id === "string" && typeof o.text === "string" ? [{ id: o.id, text: o.text }] : [];
  });
}

function parseRefs(value: Json): { documentId: string; label: string; pageNo: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return [];
    if (typeof r.documentId !== "string") return [];
    return [
      {
        documentId: r.documentId,
        label: typeof r.label === "string" ? r.label : "",
        pageNo: typeof r.pageNo === "number" ? r.pageNo : 0,
      },
    ];
  });
}

const { documentId, seed } = parseArgs(process.argv.slice(2));

const db = createClient<Database>(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: doc, error: docError } = await db
  .from("documents")
  .select("id, title")
  .eq("id", documentId)
  .maybeSingle();
if (docError) throw new Error(`Could not read the document: ${docError.message}`);
if (!doc) throw new Error(`Document ${documentId} not found`);

const rows: Row[] = [];
const PAGE = 500;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from("questions")
    .select(
      "id, type, difficulty, current_version, topics!inner(name), question_versions(version, stem, options, source_refs, basis_quote, conflict_note, answer_keys(correct_option_id, explanation, model_answer, rubric))",
    )
    .eq("status", "active")
    .order("id")
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`Could not read questions: ${error.message}`);
  rows.push(...(data as unknown as Row[]));
  if (data.length < PAGE) break;
}

const active: AuditQuestion[] = rows.flatMap((row) => {
  const version = row.question_versions.find((v) => v.version === row.current_version);
  if (!version) return [];
  const refs = parseRefs(version.source_refs);
  if (!refs.some((r) => r.documentId === documentId)) return [];
  const key = version.answer_keys;
  return [
    {
      id: row.id,
      type: row.type,
      difficulty: row.difficulty,
      topic: row.topics.name,
      stem: version.stem,
      options: parseOptions(version.options),
      correctOptionId: key?.correct_option_id ?? null,
      explanation: key?.explanation ?? null,
      modelAnswer: key?.model_answer ?? null,
      rubric: RubricSchema.safeParse(key?.rubric).data ?? null,
      sourceRefs: refs.map(({ label, pageNo }) => ({ label, pageNo })),
      basisQuote: version.basis_quote,
      conflictNote: version.conflict_note,
    },
  ];
});

const sample = sampleItems(active, seed, (q) => q.id);
const date = new Date().toISOString().slice(0, 10);
const outPath = new URL(`./audit-${date}.md`, import.meta.url);

writeFileSync(
  outPath,
  renderAudit({
    documentId,
    documentTitle: doc.title,
    date,
    seed,
    activeTotal: active.length,
    sample,
  }),
);
console.log(`Sampled ${sample.length} of ${active.length} active questions (seed ${seed}). Wrote ${outPath.pathname}`);
