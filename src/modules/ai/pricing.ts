export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD per million tokens. */
const OPUS_5: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export const PRICES_PER_MTOK: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5": OPUS_5,
  "claude-opus-4-8": OPUS_5,
};

export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES_PER_MTOK[model];
  if (!price) throw new Error(`Unknown model for pricing: ${model}`);
  // Sum before dividing so round numbers stay exact (e.g. 0.044, not 0.04400000000000001).
  const micros =
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite * price.cacheWrite;
  return micros / 1_000_000;
}
