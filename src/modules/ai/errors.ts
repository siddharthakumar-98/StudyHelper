import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The model declined to answer. Retrying the same input will not help. */
export class AiRefusalError extends AiError {
  constructor(message = "The model refused the request") {
    super(message, false);
  }
}

/** Output hit max_tokens before the JSON was complete. */
export class AiTruncatedError extends AiError {
  constructor(message = "The model output was truncated at max_tokens") {
    super(message, true);
  }
}

/** The output could not be parsed against the expected schema. */
export class AiParseError extends AiError {
  constructor(message = "The model output did not match the expected schema") {
    super(message, true);
  }
}

/** The SDK gave up waiting for the model (client timeout, R14). */
export function isAiTimeout(err: unknown): boolean {
  return err instanceof APIConnectionTimeoutError;
}

/**
 * Why one AI call failed, in plain words, when the failure belongs to the item
 * being processed (a refusal, a cut-off or unreadable answer, or a timeout).
 * Null for anything else (network, database, rate limits), which a retry of the
 * whole step should handle.
 */
export function aiItemFailureReason(err: unknown): string | null {
  if (err instanceof AiRefusalError) return "the AI declined to answer";
  if (err instanceof AiTruncatedError) return "the AI's answer was cut off";
  if (err instanceof AiParseError) return "the AI's answer could not be read";
  if (err instanceof AiError) return "the AI could not answer";
  if (isAiTimeout(err)) return "the AI took too long to answer";
  return null;
}
