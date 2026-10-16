import { containsNormalized, normalizeForMatch } from "@/lib/text";
import type { GeneratedMcq, GeneratedSaq } from "@/modules/ai/schemas/generation";
import { slideSourceText, type SlideForGeneration } from "./generate";

/** Prefix of the review notes the deterministic pre-checks write. */
export const AUTO_CHECK_PREFIX = "Auto-check: ";

const OPTION_IDS: GeneratedMcq["correct_option_id"][] = ["a", "b", "c", "d"];
const ALL_NONE_OF_THE_ABOVE = /\b(all|none)\s+(of\s+)?(the\s+)?(above|these)\b/i;
const WEIGHT_TOLERANCE = 0.01;

export function isMcq(q: GeneratedMcq | GeneratedSaq): q is GeneratedMcq {
  return "options" in q;
}

function mcqIssues(q: GeneratedMcq): string[] {
  const issues: string[] = [];
  const ids = q.options.map((o) => o.id);
  if (ids.length !== OPTION_IDS.length || !OPTION_IDS.every((id) => ids.includes(id))) {
    issues.push("MCQ must have options a, b, c, d exactly once");
  }
  if (!ids.includes(q.correct_option_id)) issues.push("Correct option is not one of the options");
  const texts = q.options.map((o) => normalizeForMatch(o.text));
  if (new Set(texts).size !== texts.length) issues.push("Two options have the same text");
  if (q.options.some((o) => ALL_NONE_OF_THE_ABOVE.test(o.text))) {
    issues.push("Options must not use 'all/none of the above'");
  }
  return issues;
}

function saqIssues(q: GeneratedSaq): string[] {
  const issues: string[] = [];
  const weights = q.rubric.criteria.map((c) => c.weight);
  if (weights.length < 3 || weights.length > 6) issues.push("Rubric needs 3–6 criteria");
  const sum = weights.reduce((total, w) => total + w, 0);
  if (Math.abs(sum - 5) > WEIGHT_TOLERANCE) issues.push("Rubric weights must add up to 5.0");
  if (weights.some((w) => !(w > 0))) issues.push("Rubric weights must be positive");
  if (!q.model_answer.trim()) issues.push("Model answer is empty");
  return issues;
}

/** Checks a generated question's shape: options, answer key and rubric. */
export function validateStructure(q: GeneratedMcq | GeneratedSaq): string[] {
  return isMcq(q) ? mcqIssues(q) : saqIssues(q);
}

/**
 * validateStructure plus source checks: every cited slide is in this batch, and
 * the basis quote occurs (after normalising) in a cited slide's text, flattened
 * tables or diagram description.
 */
export function validateGenerated(
  q: GeneratedMcq | GeneratedSaq,
  slidesInBatch: Map<string, SlideForGeneration>,
): string[] {
  const issues = validateStructure(q);
  const cited = q.source_slide_ids.map((id) => slidesInBatch.get(id));
  if (cited.some((slide) => !slide)) issues.push("Cites a slide outside this topic");
  const quoteFound =
    q.basis_quote.trim() !== "" &&
    cited.some((slide) => slide && containsNormalized(slideSourceText(slide), q.basis_quote));
  if (!quoteFound) issues.push("Basis quote not found in cited slide");
  return issues;
}
