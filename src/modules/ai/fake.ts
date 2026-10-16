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
 * One MCQ and one SAQ per batch that pass the pre-checks: both cite the first
 * slide with text (meta.quoteSlide) and quote its first line (meta.quote). Stems
 * name the document, topic and batch, so separate documents never repeat a stem.
 */
const generateResponder: FakeResponder = (input) => {
  const { topicName, batchIndex, quoteSlide, quote } = input.meta ?? {};
  if (topicName === undefined || !quoteSlide || !quote) {
    throw new Error("The fake generate responder needs meta.topicName, meta.quoteSlide and meta.quote");
  }
  const prefix = `[doc ${String(input.documentId ?? "").slice(0, 8)}] ${topicName} batch ${batchIndex ?? 0}`;
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
        stem: `${prefix} MCQ: which statement is made on the slide?`,
        options: [
          { id: "a", text: "The statement quoted on the slide" },
          { id: "b", text: "A dose twice as high" },
          { id: "c", text: "A dose half as high" },
          { id: "d", text: "A different drug" },
        ],
        correct_option_id: "a",
        explanation: "The slide states it directly.",
        difficulty: "easy",
        ...source,
      },
    ],
    saqs: [
      {
        stem: `${prefix} SAQ: summarise what the slide teaches.`,
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

/** Later tasks add one deterministic responder per task here. */
export const DEFAULT_FAKE_RESPONDERS: FakeResponders = {
  extract: extractResponder,
  topicMap: topicMapResponder,
  generate: generateResponder,
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
