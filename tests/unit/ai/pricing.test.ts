import { describe, expect, it } from "vitest";
import { costUsd } from "@/modules/ai/pricing";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

describe("costUsd", () => {
  it("prices one million opus-5-5 input tokens at $4", () => {
    expect(costUsd("claude-opus-5-5", { ...zero, input: 1_000_000 })).toBe(4);
  });

  it("combines input and output tokens", () => {
    const cost = costUsd("claude-opus-5-5", { ...zero, input: 1000, output: 2000 });
    expect(cost).toBe(0.044);
  });

  it("prices cache reads and writes", () => {
    const cost = costUsd("claude-sonnet-5-5", {
      ...zero,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.2 + 2.5, 10);
  });

  it("prices claude-opus-4-8 like claude-opus-5", () => {
    const usage = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 };
    expect(costUsd("claude-opus-4-8", usage)).toBe(costUsd("claude-opus-5", usage));
  });

  it("throws for an unknown model", () => {
    expect(() => costUsd("claude-nope", zero)).toThrow(/unknown model/i);
  });
});
