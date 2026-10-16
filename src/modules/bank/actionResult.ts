import { unstable_rethrow } from "next/navigation";
import { ForbiddenError } from "@/lib/auth";
import { BankError } from "./errors";
import { IllegalTransitionError } from "./lifecycle";

/**
 * What every Question Bank server action returns. Expected failures (a rule, a
 * stale page, an edit that does not validate, a missing role) come back as
 * `{ ok: false, error }` so the browser can show them: Next.js hides the message
 * of an error thrown from a server action in production.
 */
export type ActionResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; issues?: string[] };

/**
 * Runs an action body and turns the expected failures into `{ ok: false }`:
 * BankError (with its `issues`), ForbiddenError and IllegalTransitionError.
 * Next's own control-flow errors (requireUser's redirect to /login) and every
 * unexpected error are re-thrown, so no database text ever lands in `error`.
 */
export async function runAction<T extends object = Record<never, never>>(
  body: () => Promise<T | void>,
): Promise<ActionResult<T>> {
  try {
    const data = await body();
    return { ok: true, ...(data ?? {}) } as ActionResult<T>;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof BankError) {
      return error.issues?.length
        ? { ok: false, error: error.message, issues: error.issues }
        : { ok: false, error: error.message };
    }
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof IllegalTransitionError) {
      return { ok: false, error: "That change is not allowed for this question." };
    }
    throw error;
  }
}
