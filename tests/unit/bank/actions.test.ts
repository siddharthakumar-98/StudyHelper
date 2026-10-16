import { beforeEach, describe, expect, it, vi } from "vitest";

// The "use server" wrappers are the only authorization boundary (R11): each must
// call its guard before touching anything, and stop when the guard refuses.
const mocks = vi.hoisted(() => ({
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
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => mocks.service }));
vi.mock("@/modules/ai/usage", () => ({ getAiClient: () => mocks.ai }));
vi.mock("@/modules/bank/bankService", () => mocks.record);

const actions = await import("@/modules/bank/actions");

const refusal = new Error("refused");
const edit = { stem: "S", difficulty: "easy" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@x.test", role: "admin" });
  mocks.requireUser.mockResolvedValue({ id: "user-1", email: "s@x.test", role: "student" });
});

describe("bank server actions", () => {
  it("only export async functions", () => {
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
    ["editQuestion", () => actions.editQuestion("q1", edit), mocks.record.editRecord],
    ["regenerateQuestion", () => actions.regenerateQuestion("q1"), mocks.record.regenerateRecord],
  ])("%s requires an admin and does nothing when refused", async (_name, call, record) => {
    mocks.requireAdmin.mockRejectedValueOnce(refusal);
    await expect(call()).rejects.toBe(refusal);
    expect(record).not.toHaveBeenCalled();
    expect(mocks.requireUser).not.toHaveBeenCalled();

    await call();
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(mocks.service);
  });

  it("passes the service client, the AI client and the arguments through", async () => {
    mocks.record.editRecord.mockResolvedValue({ version: 2 });
    mocks.record.regenerateRecord.mockResolvedValue({ status: "active" });
    await expect(actions.editQuestion("q1", edit)).resolves.toEqual({ version: 2 });
    expect(mocks.record.editRecord).toHaveBeenCalledWith(mocks.service, "q1", edit);
    await expect(actions.regenerateQuestion("q1")).resolves.toEqual({ status: "active" });
    expect(mocks.record.regenerateRecord).toHaveBeenCalledWith(mocks.service, mocks.ai, "q1");
    await actions.rejectQuestion("q1", "no");
    expect(mocks.record.rejectRecord).toHaveBeenCalledWith(mocks.service, "q1", "no");
  });

  it("flagQuestion needs a signed-in user (not an admin) and flags as that user", async () => {
    mocks.requireUser.mockRejectedValueOnce(refusal);
    await expect(actions.flagQuestion("q1", "x")).rejects.toBe(refusal);
    expect(mocks.record.flagRecord).not.toHaveBeenCalled();

    await actions.flagQuestion("q1", null);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.record.flagRecord).toHaveBeenCalledWith(
      mocks.service,
      { id: "user-1", role: "student" },
      "q1",
      null,
    );
  });
});
