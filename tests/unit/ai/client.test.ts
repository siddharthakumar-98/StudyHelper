import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createAnthropicAiClient,
  type AiCallInput,
  type AiCallLog,
} from "@/modules/ai/client";
import { AiParseError, AiRefusalError, AiTruncatedError } from "@/modules/ai/errors";
import { createFakeAiClient } from "@/modules/ai/fake";
import { MODEL_CONFIG } from "@/modules/ai/models";
import { costUsd } from "@/modules/ai/pricing";

const schema = z.object({ answer: z.string() });

const input: AiCallInput<{ answer: string }> = {
  task: "verify",
  promptVersion: "verify@1",
  system: "You are a verifier.",
  content: [{ type: "text", text: "Check this." }],
  schema,
  documentId: "11111111-1111-1111-1111-111111111111",
};

function fakeSdk(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue({
    parsed_output: { answer: "ok" },
    stop_reason: "end_turn",
    model: "claude-opus-5-5",
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 300,
    },
    ...response,
  });
  const sdk = { beta: { messages: { parse } } } as unknown as Anthropic;
  return { sdk, parse };
}

describe("createAnthropicAiClient", () => {
  it("sends model, effort, fallbacks, betas and a cached system block", async () => {
    const { sdk, parse } = fakeSdk({});
    const client = createAnthropicAiClient(sdk, async () => {});
    await client.callStructured(input);

    expect(parse).toHaveBeenCalledTimes(1);
    const args = parse.mock.calls[0][0];
    expect(args.model).toBe(MODEL_CONFIG.verify.model);
    expect(args.max_tokens).toBe(MODEL_CONFIG.verify.maxTokens);
    expect(args.output_config.effort).toBe(MODEL_CONFIG.verify.effort);
    expect(args.output_config.format).toBeDefined();
    expect(args.betas).toContain("server-side-fallback-2026-07-01");
    expect(args.fallbacks).toBe("default");
    expect(args.system).toEqual([
      { type: "text", text: "You are a verifier.", cache_control: { type: "ephemeral" } },
    ]);
    expect(args.messages).toEqual([{ role: "user", content: input.content }]);
    expect(args).not.toHaveProperty("temperature");
    expect(args).not.toHaveProperty("thinking");
  });

  it("throws AiRefusalError on a refusal", async () => {
    const { sdk } = fakeSdk({ stop_reason: "refusal", parsed_output: null });
    const client = createAnthropicAiClient(sdk, async () => {});
    const err = await client.callStructured(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiRefusalError);
    expect((err as AiRefusalError).retryable).toBe(false);
  });

  it("throws AiTruncatedError when max_tokens is hit", async () => {
    const { sdk } = fakeSdk({ stop_reason: "max_tokens", parsed_output: null });
    const client = createAnthropicAiClient(sdk, async () => {});
    const err = await client.callStructured(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiTruncatedError);
    expect((err as AiTruncatedError).retryable).toBe(true);
  });

  it("throws AiParseError when parsed_output is null", async () => {
    const { sdk } = fakeSdk({ parsed_output: null });
    const client = createAnthropicAiClient(sdk, async () => {});
    const err = await client.callStructured(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiParseError);
    expect((err as AiParseError).retryable).toBe(true);
  });

  it("logs the call and returns usage and cost on success", async () => {
    const { sdk } = fakeSdk({});
    const log = vi.fn<(row: AiCallLog) => Promise<void>>().mockResolvedValue();
    const client = createAnthropicAiClient(sdk, log);
    const result = await client.callStructured(input);

    const usage = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 };
    expect(result.data).toEqual({ answer: "ok" });
    expect(result.usage).toEqual(usage);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.costUsd).toBe(costUsd("claude-opus-5-5", usage));
    expect(log).toHaveBeenCalledWith({
      task: "verify",
      model: "claude-opus-5-5",
      promptVersion: "verify@1",
      usage,
      costUsd: result.costUsd,
      documentId: input.documentId,
    });
  });

  it("treats missing cache token counts as zero", async () => {
    const { sdk } = fakeSdk({
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: undefined,
      },
    });
    const client = createAnthropicAiClient(sdk, async () => {});
    const result = await client.callStructured(input);
    expect(result.usage).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
  });

  it("prices an unpriced served model at the requested model's rate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk } = fakeSdk({ model: "claude-unknown-x" });
    const log = vi.fn<(row: AiCallLog) => Promise<void>>().mockResolvedValue();
    const client = createAnthropicAiClient(sdk, log);
    const result = await client.callStructured(input);

    const usage = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 };
    const expected = costUsd(MODEL_CONFIG.verify.model, usage);
    expect(result.data).toEqual({ answer: "ok" });
    expect(result.costUsd).toBe(expected);
    expect(result.model).toBe("claude-unknown-x");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-unknown-x", costUsd: expected }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("still returns the result when the ledger insert fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sdk } = fakeSdk({});
    const log = vi.fn<(row: AiCallLog) => Promise<void>>().mockRejectedValue(new Error("db down"));
    const client = createAnthropicAiClient(sdk, log);
    const result = await client.callStructured(input);

    expect(result.data).toEqual({ answer: "ok" });
    expect(result.costUsd).toBe(
      costUsd("claude-opus-5-5", { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 }),
    );
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("logs usage even when the call is refused", async () => {
    const { sdk } = fakeSdk({ stop_reason: "refusal", parsed_output: null });
    const log = vi.fn<(row: AiCallLog) => Promise<void>>().mockResolvedValue();
    const client = createAnthropicAiClient(sdk, log);
    await expect(client.callStructured(input)).rejects.toBeInstanceOf(AiRefusalError);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("createFakeAiClient", () => {
  it("returns the responder output, validated against the schema", async () => {
    const client = createFakeAiClient({ verify: () => ({ answer: "fake" }) });
    const result = await client.callStructured(input);
    expect(result.data).toEqual({ answer: "fake" });
    expect(result.costUsd).toBe(0);
  });

  it("throws a clear error for a task with no responder", async () => {
    const client = createFakeAiClient({});
    await expect(client.callStructured(input)).rejects.toThrow(/no fake responder.*verify/i);
  });

  it("throws AiParseError when the responder output violates the schema", async () => {
    const client = createFakeAiClient({ verify: () => ({ wrong: 1 }) });
    await expect(client.callStructured(input)).rejects.toBeInstanceOf(AiParseError);
  });
});
