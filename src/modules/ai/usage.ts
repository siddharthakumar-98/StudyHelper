import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceSupabase } from "@/lib/supabase/service";
import { createAnthropicAiClient, type AiCallLog, type AiClient } from "./client";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "./fake";

/** Records one AI call in the server-only ai_calls ledger. */
export async function logAiCall(row: AiCallLog): Promise<void> {
  const { error } = await createServiceSupabase()
    .from("ai_calls")
    .insert({
      task: row.task,
      model: row.model,
      prompt_version: row.promptVersion,
      input_tokens: row.usage.input,
      output_tokens: row.usage.output,
      cache_read_tokens: row.usage.cacheRead,
      cache_write_tokens: row.usage.cacheWrite,
      cost_usd: row.costUsd,
      document_id: row.documentId ?? null,
    });
  if (error) throw new Error(`ai_calls insert failed: ${error.message}`);
}

let cached: AiClient | undefined;

export function getAiClient(): AiClient {
  if (process.env.AI_FAKE === "1") {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("AI_FAKE=1 must not be set when VERCEL_ENV is production");
    }
    return createFakeAiClient(DEFAULT_FAKE_RESPONDERS);
  }
  // maxRetries is 0: the job engine owns retries, so one step stays under maxDuration (300 s).
  cached ??= createAnthropicAiClient(
    new Anthropic({ maxRetries: 0, timeout: 270_000 }),
    logAiCall,
  );
  return cached;
}
