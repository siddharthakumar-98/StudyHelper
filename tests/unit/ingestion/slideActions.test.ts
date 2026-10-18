import { beforeEach, describe, expect, it, vi } from "vitest";

// R11/R32 for the slide-check actions (R38): each wrapper checks the admin first,
// then hands the service client to slideService, and returns a result object.
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
    slides: {
      latestJobOf: vi.fn(),
      latestJobsOf: vi.fn(),
      pageViewUrlFor: vi.fn(),
      startQuestionWritingRecord: vi.fn(),
      updateSlideTextRecord: vi.fn(),
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
vi.mock("@/modules/ingestion/slideService", () => mocks.slides);
vi.mock("@/modules/ingestion/uploadService", () => ({}));

const actions = await import("@/modules/ingestion/upload");
const { BankError } = await import("@/modules/bank/errors");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@x.test", role: "admin" });
});

describe("slide-check actions", () => {
  it.each([
    ["startQuestionWriting", () => actions.startQuestionWriting("d1"), mocks.slides.startQuestionWritingRecord],
    ["updateSlideText", () => actions.updateSlideText("s1", "text"), mocks.slides.updateSlideTextRecord],
  ])("%s requires an admin and does nothing when refused", async (_name, call, record) => {
    mocks.requireAdmin.mockRejectedValueOnce(new mocks.ForbiddenError());
    expect(await call()).toEqual({ ok: false, error: "Admin access required" });
    expect(record).not.toHaveBeenCalled();
  });

  it("startQuestionWriting returns the job to run, or the reason it cannot start", async () => {
    mocks.slides.startQuestionWritingRecord.mockResolvedValueOnce({ jobId: "j1" });
    expect(await actions.startQuestionWriting("d1")).toEqual({ ok: true, jobId: "j1" });
    expect(mocks.slides.startQuestionWritingRecord).toHaveBeenCalledWith(mocks.service, "d1");
    mocks.slides.startQuestionWritingRecord.mockRejectedValueOnce(new BankError("Not waiting"));
    expect(await actions.startQuestionWriting("d1")).toEqual({ ok: false, error: "Not waiting" });
  });

  it("updateSlideText reports how many questions went back for review", async () => {
    mocks.slides.updateSlideTextRecord.mockResolvedValueOnce({ questionsSentToReview: 2 });
    expect(await actions.updateSlideText("s1", "fixed")).toEqual({ ok: true, questionsSentToReview: 2 });
    expect(mocks.slides.updateSlideTextRecord).toHaveBeenCalledWith(mocks.service, "s1", "fixed");
  });
});
