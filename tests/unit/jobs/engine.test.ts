import { describe, expect, it, vi } from "vitest";
import { AiRefusalError } from "@/modules/ai/errors";
import type { JobRow } from "@/modules/jobs/types";
import { createJob, resetJob, runJobStep } from "@/modules/jobs/engine";
import { MemoryJobStore } from "@/modules/jobs/store";
import type { JobHandler, JobKind } from "@/modules/jobs/types";

const deps = { ai: {} as never, db: {} as never };
const DOC = "00000000-0000-0000-0000-000000000001";

type Handlers = Partial<Record<JobKind, JobHandler>>;

async function setup(handlers: Handlers, kind: JobKind = "split") {
  const store = new MemoryJobStore();
  const id = await createJob(store, kind, DOC, { a: 1 });
  return { store, id, handlers };
}

describe("runJobStep", () => {
  it("advances step and stores progress", async () => {
    const handler = vi.fn<JobHandler>(async (ctx) => ({
      done: false,
      progress: { current: ctx.step + 1, total: 3, label: `Page ${ctx.step + 1} of 3` },
    }));
    const { store, id, handlers } = await setup({ split: handler });

    const first = await runJobStep(store, handlers, id, deps);
    expect(first.status).toBe("pending");
    expect(first.progress).toEqual({ current: 1, total: 3, label: "Page 1 of 3" });
    expect(handler.mock.calls[0][0]).toMatchObject({
      jobId: id,
      documentId: DOC,
      step: 0,
      payload: { a: 1 },
    });

    await runJobStep(store, handlers, id, deps);
    expect(handler.mock.calls[1][0].step).toBe(1);
    expect((await store.get(id)).locked_until).toBeNull();
  });

  it("done with next creates the next job and links nextJobId", async () => {
    const { store, id, handlers } = await setup({
      split: async () => ({
        done: true,
        progress: { current: 3, total: 3, label: "Page 3 of 3" },
        next: { kind: "extract", payload: { from: "split" } },
      }),
    });
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap.status).toBe("done");
    expect(snap.nextJobId).toBeTruthy();
    const next = await store.get(snap.nextJobId!);
    expect(next).toMatchObject({
      kind: "extract",
      document_id: DOC,
      payload: { from: "split" },
      status: "pending",
      step: 0,
    });
  });

  it("handler error increments attempts, stores message, returns pending", async () => {
    const { store, id, handlers } = await setup({
      split: async () => {
        throw new Error("boom");
      },
    });
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap).toMatchObject({ status: "pending", attempts: 1, error: "boom" });
    expect((await store.get(id)).locked_until).toBeNull();
  });

  it("third consecutive error marks failed", async () => {
    const { store, id, handlers } = await setup({
      split: async () => {
        throw new Error("boom");
      },
    });
    await runJobStep(store, handlers, id, deps);
    await runJobStep(store, handlers, id, deps);
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap).toMatchObject({ status: "failed", attempts: 3, error: "boom" });
  });

  it("a success resets the consecutive-error count", async () => {
    let calls = 0;
    const { store, id, handlers } = await setup({
      split: async () => {
        calls += 1;
        if (calls === 1) throw new Error("flaky");
        return { done: false, progress: { current: 1, total: 9, label: "x" } };
      },
    });
    await runJobStep(store, handlers, id, deps);
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap).toMatchObject({ attempts: 0, error: null, status: "pending" });
  });

  it("a refusal goes through the normal 3-attempt path", async () => {
    const { store, id, handlers } = await setup({
      split: async () => {
        throw new AiRefusalError();
      },
    });
    expect(await runJobStep(store, handlers, id, deps)).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    await runJobStep(store, handlers, id, deps);
    expect(await runJobStep(store, handlers, id, deps)).toMatchObject({
      status: "failed",
      attempts: 3,
    });
  });

  it("a claim that would exceed 3 attempts fails the job without running the handler", async () => {
    const handler = vi.fn<JobHandler>();
    const { store, id, handlers } = await setup({ split: handler });
    // Three steps killed by a timeout: claimed, never saved.
    for (let i = 0; i < 3; i++) {
      expect(await store.claim(id, 0)).not.toBeNull();
      await new Promise((r) => setTimeout(r, 2));
    }
    const snap = await runJobStep(store, handlers, id, deps);
    expect(handler).not.toHaveBeenCalled();
    expect(snap.status).toBe("failed");
    expect(snap.error).toContain("stopped unexpectedly");
  });

  it("save after a lost lock does not clobber the new owner's result", async () => {
    const store = new MemoryJobStore();
    const id = await createJob(store, "split", DOC, {});
    const slow = (await store.claim(id, 0)) as JobRow;
    await new Promise((r) => setTimeout(r, 2));
    const fresh = (await store.claim(id, 300)) as JobRow; // lock expired; takeover
    expect(fresh).not.toBeNull();
    const stale: JobRow = { ...slow, status: "done", locked_until: null };
    expect(await store.save(stale, slow.locked_until)).toBe(false);
    expect((await store.get(id)).status).toBe("running");
    const winner: JobRow = { ...fresh, status: "pending", step: 1, locked_until: null };
    expect(await store.save(winner, fresh.locked_until)).toBe(true);
    expect((await store.get(id)).step).toBe(1);
  });

  it("reset only affects a failed job", async () => {
    const store = new MemoryJobStore();
    const id = await createJob(store, "split", DOC, {});
    await store.claim(id, 300); // another tab owns it now
    expect(await store.reset(id)).toBe(false);
    expect((await store.get(id)).status).toBe("running");
  });

  it("locked job returns snapshot without invoking handler", async () => {
    const handler = vi.fn<JobHandler>();
    const { store, id, handlers } = await setup({ split: handler });
    expect(await store.claim(id, 300)).not.toBeNull();
    const snap = await runJobStep(store, handlers, id, deps);
    expect(handler).not.toHaveBeenCalled();
    expect(snap.id).toBe(id);
    expect(snap.status).toBe("running");
  });

  it("done job never invokes handler", async () => {
    const handler = vi.fn<JobHandler>(async () => ({
      done: true,
      progress: { current: 1, total: 1, label: "ok" },
    }));
    const { store, id, handlers } = await setup({ split: handler });
    await runJobStep(store, handlers, id, deps);
    const snap = await runJobStep(store, handlers, id, deps);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(snap.status).toBe("done");
  });

  it('missing handler marks failed with "No handler for <kind>"', async () => {
    const { store, id, handlers } = await setup({}, "verify");
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap).toMatchObject({ status: "failed", error: "No handler for verify" });
    expect((await store.get(id)).locked_until).toBeNull();
  });
});

describe("attempt and repeatStep (R37)", () => {
  it("passes the claimed attempt (1-based) to the handler, and starts again at 1 after a success", async () => {
    const seen: number[] = [];
    let calls = 0;
    const { store, id, handlers } = await setup({
      split: async (ctx) => {
        seen.push(ctx.attempt);
        calls += 1;
        if (calls <= 2) throw new Error("flaky");
        return { done: false, progress: { current: 1, total: 9, label: "x" } };
      },
    });
    for (let i = 0; i < 4; i++) await runJobStep(store, handlers, id, deps);
    expect(seen).toEqual([1, 2, 3, 1]);
  });

  it("repeatStep keeps the step number but counts as a success", async () => {
    const steps: number[] = [];
    let calls = 0;
    const { store, id, handlers } = await setup({
      split: async (ctx) => {
        steps.push(ctx.step);
        calls += 1;
        if (calls === 1) throw new Error("flaky");
        if (calls === 2) {
          return { done: false, repeatStep: true, progress: { current: 0, total: 2, label: "split" } };
        }
        return { done: false, progress: { current: 1, total: 2, label: "x" } };
      },
    });
    await runJobStep(store, handlers, id, deps);
    const repeated = await runJobStep(store, handlers, id, deps);
    expect(repeated).toMatchObject({ status: "pending", attempts: 0, error: null });
    expect((await store.get(id)).step).toBe(0);
    await runJobStep(store, handlers, id, deps);
    expect(steps).toEqual([0, 0, 0]);
    expect((await store.get(id)).step).toBe(1);
  });
});

describe("resetJob", () => {
  it("retry() on failed job resets attempts to 0 and status pending", async () => {
    const { store, id, handlers } = await setup({
      split: async () => {
        throw new Error("boom");
      },
    });
    for (let i = 0; i < 3; i++) await runJobStep(store, handlers, id, deps);
    expect((await store.get(id)).status).toBe("failed");

    const snap = await resetJob(store, id);
    expect(snap).toMatchObject({ status: "pending", attempts: 0, error: null });
    expect((await store.get(id)).locked_until).toBeNull();
  });
});
