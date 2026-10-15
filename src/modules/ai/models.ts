export type AiTask = "extract" | "topicMap" | "generate" | "verify" | "dedup";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelConfig {
  model: string;
  effort: Effort;
  maxTokens: number;
}

const OPUS = "claude-opus-5-5";

export const MODEL_CONFIG: Record<AiTask, ModelConfig> = {
  extract: { model: OPUS, effort: "high", maxTokens: 16000 },
  topicMap: { model: OPUS, effort: "high", maxTokens: 16000 },
  generate: { model: OPUS, effort: "high", maxTokens: 16000 },
  verify: { model: OPUS, effort: "high", maxTokens: 8000 },
  dedup: { model: OPUS, effort: "low", maxTokens: 2000 },
};
