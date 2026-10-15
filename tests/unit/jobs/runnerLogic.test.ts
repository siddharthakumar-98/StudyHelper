import { describe, expect, it } from "vitest";
import { decideNext, startJobId } from "@/components/jobs/runnerLogic";
import type { JobSnapshot } from "@/modules/jobs/types";

const snap = (over: Partial<JobSnapshot>): JobSnapshot => ({
  id: "job-1",
  kind: "split",
  status: "pending",
  progress: null,
  error: null,
  nextJobId: null,
  attempts: 0,
  ...over,
});

describe("decideNext", () => {
  it("keeps posting to a pending job", () => {
    expect(decideNext(snap({}))).toEqual({ action: "post", id: "job-1", delayMs: 0 });
  });
  it("polls with a delay while another runner holds the lock", () => {
    const d = decideNext(snap({ status: "running" }));
    expect(d).toMatchObject({ action: "post", id: "job-1" });
    expect(d.action === "post" && d.delayMs).toBeGreaterThan(0);
  });
  it("follows nextJobId when done, stops when there is none", () => {
    expect(decideNext(snap({ status: "done", nextJobId: "job-2" }))).toEqual({
      action: "post",
      id: "job-2",
      delayMs: 0,
    });
    expect(decideNext(snap({ status: "done" }))).toEqual({ action: "stop" });
  });
  it("stops on failure", () => {
    expect(decideNext(snap({ status: "failed" }))).toEqual({ action: "stop" });
  });
});

describe("startJobId", () => {
  it("restarts from the failed job, not the head of the chain", () => {
    expect(startJobId("head", snap({ id: "third", status: "failed" }))).toBe("third");
  });
  it("starts from the given job otherwise", () => {
    expect(startJobId("head", null)).toBe("head");
    expect(startJobId("head", snap({ id: "second", status: "pending" }))).toBe("head");
  });
});
