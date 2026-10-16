import { describe, expect, it } from "vitest";
import { documentStatusView, STUDENT_ATTENTION_COPY } from "@/components/materials/status";

const job = (status: "pending" | "running" | "done" | "failed", id = "j1") => ({
  id,
  status,
  kind: "extract",
});

describe("documentStatusView", () => {
  it("a ready handout shows Ready with nothing to run or poll", () => {
    // The newest job is done (or even a not-yet-done verify read just before the document).
    for (const latest of [null, job("done"), job("pending")]) {
      const view = documentStatusView({ docStatus: "ready", latestJob: latest, isAdmin: false });
      expect(view).toMatchObject({ label: "Ready", studentNotice: null, poll: false });
    }
  });

  it("students see 'still being prepared' while a job is unfinished and keep refreshing", () => {
    for (const status of ["pending", "running"] as const) {
      expect(
        documentStatusView({ docStatus: "processing", latestJob: job(status), isAdmin: false }),
      ).toMatchObject({ label: "Reading slides", studentNotice: "preparing", poll: true });
    }
  });

  it("students get plain failure wording when the latest job failed", () => {
    const view = documentStatusView({
      docStatus: "processing",
      latestJob: job("failed"),
      isAdmin: false,
    });
    expect(view.studentNotice).toBe("attention");
    expect(view.poll).toBe(true);
    expect(STUDENT_ATTENTION_COPY).toBe(
      "This handout needs attention before its slides are ready. Please check back later.",
    );
  });

  it("admins get no student notice; their runner drives refreshes while a job is open", () => {
    const view = documentStatusView({ docStatus: "processing", latestJob: job("pending"), isAdmin: true });
    expect(view).toMatchObject({ studentNotice: null, poll: false, runnerJobId: "j1" });
    const failed = documentStatusView({ docStatus: "processing", latestJob: job("failed"), isAdmin: true });
    expect(failed).toMatchObject({ studentNotice: null, poll: false, runnerJobId: "j1" });
  });

  it("admins poll when a not-ready handout has no job left to run", () => {
    expect(
      documentStatusView({ docStatus: "processing", latestJob: job("done"), isAdmin: true }),
    ).toMatchObject({ poll: true, runnerJobId: null });
    expect(
      documentStatusView({ docStatus: "processing", latestJob: null, isAdmin: true }),
    ).toMatchObject({ poll: true, runnerJobId: null });
  });

  it("an upload that never finished has nothing to wait for", () => {
    expect(
      documentStatusView({ docStatus: "uploading", latestJob: null, isAdmin: false }),
    ).toMatchObject({ label: "Upload not finished", studentNotice: null, poll: false });
  });
});

describe("documentStatusView with a requested job", () => {
  it("an admin who opened ?job= runs that job and does not poll", () => {
    expect(
      documentStatusView({
        docStatus: "processing",
        latestJob: job("done"),
        isAdmin: true,
        requestedJobId: "first",
      }),
    ).toMatchObject({ runnerJobId: "first", poll: false });
  });

  it("students never get a runner, even with a requested job", () => {
    expect(
      documentStatusView({
        docStatus: "processing",
        latestJob: job("pending"),
        isAdmin: false,
        requestedJobId: "first",
      }).runnerJobId,
    ).toBeNull();
  });
});
