import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));

const { redirect } = await import("next/navigation");
const { ForbiddenError } = await import("@/lib/auth");
const { runAction } = await import("@/modules/bank/actionResult");
const { BankError } = await import("@/modules/bank/errors");
const { IllegalTransitionError } = await import("@/modules/bank/lifecycle");

describe("runAction", () => {
  it("returns ok with the data, or just ok", async () => {
    expect(await runAction(async () => ({ version: 2 }))).toEqual({ ok: true, version: 2 });
    expect(await runAction(async () => {})).toEqual({ ok: true });
  });

  it("turns the expected failures into a failed result", async () => {
    expect(await runAction(async () => { throw new BankError("Nope"); })).toEqual({ ok: false, error: "Nope" });
    expect(
      await runAction(async () => { throw new BankError("A. B", ["A", "B"]); }),
    ).toEqual({ ok: false, error: "A. B", issues: ["A", "B"] });
    expect(await runAction(async () => { throw new ForbiddenError(); })).toEqual({
      ok: false,
      error: "Admin access required",
    });
    const illegal = new IllegalTransitionError("retired", "approve", "admin", "internal detail");
    const result = await runAction(async () => { throw illegal; });
    expect(result).toEqual({ ok: false, error: "That change is not allowed for this question." });
  });

  it("re-throws Next's redirect (what requireUser does when signed out)", async () => {
    const thrown = await runAction(async () => redirect("/login")).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });
  });

  it("re-throws unexpected errors without wrapping them", async () => {
    const boom = new Error("relation \"answer_keys\" does not exist");
    await expect(runAction(async () => { throw boom; })).rejects.toBe(boom);
  });
});
