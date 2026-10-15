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

/** Later tasks add one deterministic responder per task here. */
export const DEFAULT_FAKE_RESPONDERS: FakeResponders = {
  extract: extractResponder,
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
