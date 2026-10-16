import { beforeEach, describe, expect, it, vi } from "vitest";

// The "use server" wrappers are the only authorization boundary (R11): each must
// call its guard before touching anything, and stop when the guard refuses.
const mocks = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(message = "Admin access required") {
      super(message);
      this.name = "ForbiddenError";
    }
  }
  return {
    ForbiddenError,
    requireAdmin: vi.fn(),
    requireUser: vi.fn(),
    service: { __service: true },
    ai: { __ai: true },
    record: {
      approveRecord: vi.fn(),
      rejectRecord: vi.fn(),
      editRecord: vi.fn(),
      regenerateRecord: vi.fn(),
      flagRecord: vi.fn(),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  ForbiddenError: mocks.ForbiddenError,
  requireAdmin: mocks.requireAdmin,
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => mocks.service }));
vi.mock("@/modules/ai/usage", () => ({ getAiClient: () => mocks.ai }));
vi.mock("@/modules/bank/bankService", () => mocks.record);

const actions = await import("@/modules/bank/actions");
const { BankError } = await import("@/modules/bank/errors");

const edit = { stem: "S", difficulty: "easy" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@x.test", role: "admin" });
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "s@x.test", role: "student" });
});

describe("bank server actions", () => {
  it("only export the five actions", () => {
    expect(Object.keys(actions).sort()).toEqual([
      "approveQuestion",
      "editQuestion",
      "flagQuestion",
      "regenerateQuestion",
      "rejectQuestion",
    ]);
  });

  it.each([
    ["approveQuestion", () => actions.approveQuestion("q1"), mocks.record.approveRecord],
    ["rejectQuestion", () => actions.rejectQuestion("q1", "why"), mocks.record.rejectRecord],
    ["editQuestion", () => actions.editQuestion("q1", edit, 3), mocks.record.editRecord],
    ["regenerateQuestion", () => actions.regenerateQuestion("q1", 3), mocks.record.regenerateRecord],
  ])("%s requires an admin and does nothing when refused", async (_name, call, record) => {
    mocks.requireAdmin.mockRejectedValueOnce(new mocks.ForbiddenError());
    expect(await call()).toEqual({ ok: false, error: "Admin access required" });
    expect(record).not.toHaveBeenCalled();
    expect(mocks.requireUser).not.toHaveBeenCalled();

    expect(await call()).toMatchObject({ ok: true });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(mocks.service);
  });

  it("passes the service client, the AI client, the arguments and the expected version through", async () => {
    mocks.record.editRecord.mockResolvedValue({ version: 4 });
    mocks.record.regenerateRecord.mockResolvedValue({ status: "active" });
    expect(await actions.editQuestion("q1", edit, 3)).toEqual({ ok: true, version: 4 });
    expect(mocks.record.editRecord).toHaveBeenCalledWith(mocks.service, "q1", edit, 3);
    expect(await actions.regenerateQuestion("q1", 3)).toEqual({ ok: true, status: "active" });
    expect(mocks.record.regenerateRecord).toHaveBeenCalledWith(mocks.service, mocks.ai, "q1", 3);
    expect(await actions.rejectQuestion("q1", "no")).toEqual({ ok: true });
    expect(mocks.record.rejectRecord).toHaveBeenCalledWith(mocks.service, "q1", "no");
  });

  it("returns a BankError as a failed result, with its issues", async () => {
    mocks.record.editRecord.mockRejectedValueOnce(new BankError("A. B", ["A", "B"]));
    expect(await actions.editQuestion("q1", edit, 1)).toEqual({ ok: false, error: "A. B", issues: ["A", "B"] });
    mocks.record.approveRecord.mockRejectedValueOnce(new BankError("Not now"));
    expect(await actions.approveQuestion("q1")).toEqual({ ok: false, error: "Not now" });
  });

  it("still throws an unexpected error (no raw text in a result)", async () => {
    const boom = new Error("duplicate key value violates unique constraint secret_idx");
    mocks.record.rejectRecord.mockRejectedValueOnce(boom);
    await expect(actions.rejectQuestion("q1", "why")).rejects.toBe(boom);
    mocks.requireAdmin.mockRejectedValueOnce(boom);
    await expect(actions.approveQuestion("q1")).rejects.toBe(boom);
  });

  it("flagQuestion needs a signed-in user (not an admin) and flags as that user", async () => {
    const redirectLike = new Error("NEXT_REDIRECT:/login");
    mocks.requireUser.mockRejectedValueOnce(redirectLike);
    await expect(actions.flagQuestion("q1", "x")).rejects.toBe(redirectLike);
    expect(mocks.record.flagRecord).not.toHaveBeenCalled();

    expect(await actions.flagQuestion("q1", null)).toEqual({ ok: true });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.record.flagRecord).toHaveBeenCalledWith(
      mocks.service,
      { id: "user-1", role: "student" },
      "q1",
      null,
    );
  });
});
