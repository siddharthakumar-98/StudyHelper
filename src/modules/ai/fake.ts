import type { AiCallInput, AiClient } from "./client";
import { AiParseError } from "./errors";
import type { AiTask } from "./models";

export type FakeResponder = (input: AiCallInput<unknown>) => unknown;

export type FakeResponders = Partial<Record<AiTask, FakeResponder>>;

/** One clear slide per page, numbered after the page (meta.pageNo). */
const extractResponder: FakeResponder = (input) => {
  const pageNo = input.meta?.pageNo;
  if (pageNo === undefined) throw new Error("The fake extract responder needs meta.pageNo");
  return {
    slides: [
      {
        position_on_page: 1,
        printed_slide_no: String(pageNo),
        title: `Fixture slide ${pageNo}`,
        verbatim_text: `Fixture slide text for page ${pageNo}. Metformin 500 mg.`,
        tables: [],
        diagram_description: null,
        legibility: "clear",
        uncertain_terms: [],
        cropped: false,
      },
    ],
  };
};

const idList = (value: string | number | undefined) =>
  String(value ?? "").split(",").filter(Boolean);

/** Every readable slide alias (meta.readableSlideAliases) goes into one topic; the rest are unassigned. */
const topicMapResponder: FakeResponder = (input) => {
  const readable = idList(input.meta?.readableSlideAliases);
  const unreadable = idList(input.meta?.slideAliases).filter((id) => !readable.includes(id));
  return {
    topics: readable.length > 0 ? [{ name: "Fixture topic", slide_ids: readable }] : [],
    unassigned: unreadable.map((slide_id) => ({ slide_id, reason: "unreadable" })),
  };
};

/**
 * Eight made-up five-letter words for one question of one batch (MCQ or SAQ),
 * drawn from a fixed pseudo-random sequence per (batch, type). Stems of different
 * batches and types then share almost no trigrams beyond their common prefix, so
 * they stay far below the auto-duplicate threshold. They can still be dedup
 * candidates (the shared prefix alone can reach SIMILAR_STEM_THRESHOLD); the
 * fake dedup then answers "not a duplicate".
 */
function stemWords(batchIndex: number, kind: "mcq" | "saq"): string {
  let seed = (batchIndex * 2 + (kind === "saq" ? 1 : 0) + 1) >>> 0;
  const letter = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return String.fromCharCode(97 + ((seed >>> 16) % 26));
  };
  return Array.from({ length: 8 }, () => Array.from({ length: 5 }, letter).join("")).join(" ");
}

/**
 * One MCQ and one SAQ per batch that pass the pre-checks: both cite the first
 * slide with text (meta.quoteSlide) and quote its first line (meta.quote). Stems
 * name the document, topic and batch, so separate documents never repeat a stem,
 * and carry words unique to the batch and type (stemWords).
 */
const generateResponder: FakeResponder = (input) => {
  const { topicName, batchIndex, quoteSlide, quote } = input.meta ?? {};
  if (topicName === undefined || !quoteSlide || !quote) {
    throw new Error("The fake generate responder needs meta.topicName, meta.quoteSlide and meta.quote");
  }
  const batch = Number(batchIndex ?? 0);
  const prefix = `[doc ${String(input.documentId ?? "").slice(0, 8)}] ${topicName} batch ${batch}`;
  const source = {
    source_slide_ids: [String(quoteSlide)],
    basis_quote: String(quote),
    conflict_note: null,
  };
  const criterion = (id: string, statement: string, weight: number) => ({
    id,
    statement,
    weight,
    equivalents: [],
    partial_credit_examples: [],
  });
  return {
    mcqs: [
      {
        stem: `${prefix} MCQ: ${stemWords(batch, "mcq")}?`,
        options: [
          { id: "a", text: "The quoted statement" },
          { id: "b", text: "A dose twice as high" },
          { id: "c", text: "A dose half as high" },
          { id: "d", text: "A different drug" },
        ],
        correct_option_id: "a",
        explanation: "The course material states it directly.",
        difficulty: "easy",
        ...source,
      },
    ],
    saqs: [
      {
        stem: `${prefix} SAQ: ${stemWords(batch, "saq")}.`,
        model_answer: String(quote),
        key_concepts: [{ concept: String(quote), equivalents: [] }],
        rubric: {
          criteria: [
            criterion("c1", "Names the drug", 2),
            criterion("c2", "Gives the dose", 1.5),
            criterion("c3", "Gives the frequency", 1.5),
          ],
          critical_errors: [{ id: "e1", statement: "Gives a different dose" }],
        },
        difficulty: "medium",
        ...source,
      },
    ],
    skipped_slides: [],
  };
};

/** Passes every question unless its stem (meta.stem) contains "FAIL". */
const verifyResponder: FakeResponder = (input) => {
  const stem = String(input.meta?.stem ?? "");
  const mcq = input.meta?.type === "mcq";
  const fail = stem.includes("FAIL");
  return {
    answer_supported_by_slide: !fail,
    single_best_answer_ok: mcq ? true : null,
    rubric_consistent: mcq ? null : true,
    ambiguous: false,
    stem_gives_away_answer: false,
    guideline_conflict: null,
    issues: fail ? ["The fake verifier fails stems that contain FAIL"] : [],
    pass: !fail,
  };
};

/** Never a duplicate unless the stem (meta.stem) contains "DUP": then of the first candidate. */
const dedupResponder: FakeResponder = (input) => {
  const stem = String(input.meta?.stem ?? "");
  const first = idList(input.meta?.candidates)[0] ?? null;
  return stem.includes("DUP") && first
    ? { duplicate_of_question_id: first, reason: "The fake dedup marks stems that contain DUP" }
    : { duplicate_of_question_id: null, reason: "The fake dedup finds no duplicate" };
};

export const DEFAULT_FAKE_RESPONDERS: FakeResponders = {
  extract: extractResponder,
  topicMap: topicMapResponder,
  generate: generateResponder,
  verify: verifyResponder,
  dedup: dedupResponder,
};

export function createFakeAiClient(responders: FakeResponders): AiClient {
  return {
    async callStructured<T>(input: AiCallInput<T>) {
      const responder = responders[input.task];
      if (!responder) {
        throw new Error(`No fake responder registered for AI task "${input.task}"`);
      }
      const parsed = input.schema.safeParse(responder(input as AiCallInput<unknown>));
      if (!parsed.success) {
        throw new AiParseError(
          `Fake responder for "${input.task}" violates its schema: ${parsed.error.message}`,
        );
      }
      return {
        data: parsed.data,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        costUsd: 0,
        model: "fake",
      };
    },
  };
}
