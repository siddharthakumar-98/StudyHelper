import { describe, expect, it } from "vitest";
import {
  TRANSIENT_RETRY_DELAYS_MS,
  decideNext,
  startJobId,
  transientRetryDelay,
} from "@/components/jobs/runnerLogic";
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

describe("transientRetryDelay (item 4)", () => {
  it("waits 2 s, 5 s, then 10 s after a network error or a 5xx, then gives up", () => {
    expect(TRANSIENT_RETRY_DELAYS_MS).toEqual([2000, 5000, 10000]);
    for (const status of [null, 500, 502, 503, 504]) {
      expect([0, 1, 2, 3].map((n) => transientRetryDelay(status, n))).toEqual([2000, 5000, 10000, null]);
    }
  });

  it("never retries a sign-out or another client error by itself", () => {
    for (const status of [401, 403, 404, 400]) expect(transientRetryDelay(status, 0)).toBeNull();
  });
});
