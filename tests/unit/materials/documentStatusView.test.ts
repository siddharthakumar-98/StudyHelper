import { describe, expect, it } from "vitest";
import {
  documentStatusView,
  STUDENT_ATTENTION_COPY,
  STUDENT_REVIEWING_COPY,
} from "@/components/materials/status";

const job = (status: "pending" | "running" | "done" | "failed", id = "j1", kind = "extract") => ({
  id,
  status,
  kind,
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

describe("documentStatusView while the slides wait for the admin's check (R38)", () => {
  it("an admin sees 'Slides are ready to check' and the Write questions button, with no runner or polling", () => {
    for (const requestedJobId of [null, "first"]) {
      expect(
        documentStatusView({ docStatus: "review", latestJob: job("done"), isAdmin: true, requestedJobId }),
      ).toEqual({
        label: "Slides are ready to check",
        studentNotice: null,
        runnerJobId: null,
        poll: false,
        writeQuestions: true,
      });
    }
  });

  it("a student is told the slides are being checked, and the page keeps refreshing", () => {
    const view = documentStatusView({ docStatus: "review", latestJob: job("done"), isAdmin: false });
    expect(view).toMatchObject({ studentNotice: "reviewing", runnerJobId: null, poll: true, writeQuestions: false });
    expect(STUDENT_REVIEWING_COPY).toBe("Slides are being checked before questions are written.");
  });

  it("once Write questions started a job, the admin's runner drives it (the open job beats an old ?job=)", () => {
    expect(
      documentStatusView({
        docStatus: "processing",
        latestJob: job("pending", "tm", "topic_map"),
        isAdmin: true,
        requestedJobId: "first",
      }),
    ).toMatchObject({ runnerJobId: "tm", writeQuestions: false, poll: false });
  });
});

describe("documentStatusView labels the real stage (item 12)", () => {
  it.each([
    ["split", "Preparing pages"],
    ["extract", "Reading slides"],
    ["topic_map", "Finding topics"],
    ["generate", "Writing questions"],
    ["verify", "Checking questions"],
  ])("a %s job shows %s", (kind, label) => {
    for (const isAdmin of [true, false]) {
      expect(
        documentStatusView({ docStatus: "processing", latestJob: job("pending", "j", kind), isAdmin }).label,
      ).toBe(label);
    }
  });
});
