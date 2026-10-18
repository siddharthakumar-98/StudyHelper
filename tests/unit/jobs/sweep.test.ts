import { describe, expect, it } from "vitest";
import { CRON_START_WINDOW_MS, sweepJobs } from "@/modules/jobs/sweep";
import type { JobSnapshot } from "@/modules/jobs/types";

const snap = (id: string, over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id,
  kind: "extract",
  status: "pending",
  progress: null,
  error: null,
  nextJobId: null,
  attempts: 0,
  ...over,
});

/** A clock that each step moves on by `stepMs`. */
function harness(stepMs: number, outcome: (id: string, n: number) => JobSnapshot, ran = true) {
  let now = 0;
  const calls: string[] = [];
  const runStep = async (id: string) => {
    calls.push(id);
    now += stepMs;
    return { snapshot: outcome(id, calls.length), ran };
  };
  return { calls, runStep, clock: () => now };
}

describe("sweepJobs (item 15)", () => {
  it("starts steps only in the first 20 s, so a step of up to 280 s still ends inside the 300 s limit", () => {
    expect(CRON_START_WINDOW_MS).toBe(20_000);
    expect(300_000 - CRON_START_WINDOW_MS).toBeGreaterThanOrEqual(280_000);
  });

  it("keeps stepping quick jobs until the start window closes", async () => {
    const h = harness(7_000, (id) => snap(id));
    const steps = await sweepJobs(["a", "b"], h.runStep, h.clock);
    // Starts at 0, 7 and 14 s; at 21 s the window is closed.
    expect(h.calls).toEqual(["a", "a", "a"]);
    expect(steps).toBe(3);
  });

  it("never starts a step after one slow step used the window", async () => {
    const h = harness(250_000, (id) => snap(id));
    await sweepJobs(["a", "b"], h.runStep, h.clock);
    expect(h.calls).toEqual(["a"]);
  });

  it("follows a finished job into its successor, and moves on from a failing or locked job", async () => {
    const h = harness(1_000, (id) =>
      id === "a" ? snap("a", { status: "done", nextJobId: "a2" }) : id === "a2" ? snap("a2", { status: "done" }) : snap(id, { error: "boom" }),
    );
    await sweepJobs(["a", "b", "c"], h.runStep, h.clock);
    expect(h.calls).toEqual(["a", "a2", "b", "c"]);

    const locked = harness(1_000, (id) => snap(id), false);
    await sweepJobs(["x", "y"], locked.runStep, locked.clock);
    expect(locked.calls).toEqual(["x", "y"]);
  });
});
