import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AiParseError, AiRefusalError, AiTruncatedError } from "./errors";
import { MODEL_CONFIG, type AiTask } from "./models";
import { costUsd, type TokenUsage } from "./pricing";

export interface AiCallInput<T> {
  task: AiTask;
  promptVersion: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  documentId?: string;
}

export interface AiCallResult<T> {
  data: T;
  usage: TokenUsage;
  costUsd: number;
  model: string;
}

export interface AiClient {
  callStructured<T>(input: AiCallInput<T>): Promise<AiCallResult<T>>;
}

export interface AiCallLog {
  task: AiTask;
  model: string;
  promptVersion: string;
  usage: TokenUsage;
  costUsd: number;
  documentId?: string;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createAnthropicAiClient(
  sdk: Anthropic,
  log: (row: AiCallLog) => Promise<void>,
): AiClient {
  return {
    async callStructured<T>(input: AiCallInput<T>): Promise<AiCallResult<T>> {
      const config = MODEL_CONFIG[input.task];
      const response = await sdk.beta.messages.parse({
        model: config.model,
        max_tokens: config.maxTokens,
        system: [
          { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: input.content }],
        output_config: { effort: config.effort, format: betaZodOutputFormat(input.schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });

      const usage: TokenUsage = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      };
      const cost = costUsd(response.model, usage);

      // Every call that consumed tokens is recorded, including refusals and
      // truncations. A ledger failure must not discard a paid-for result.
      try {
        await log({
          task: input.task,
          model: response.model,
          promptVersion: input.promptVersion,
          usage,
          costUsd: cost,
          documentId: input.documentId,
        });
      } catch (error) {
        console.error("Failed to record ai_calls row", error);
      }

      if (response.stop_reason === "refusal") throw new AiRefusalError();
      if (response.stop_reason === "max_tokens") throw new AiTruncatedError();
      if (response.parsed_output == null) throw new AiParseError();

      return { data: response.parsed_output, usage, costUsd: cost, model: response.model };
    },
  };
}
