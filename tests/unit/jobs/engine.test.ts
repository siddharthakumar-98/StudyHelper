import { describe, expect, it, vi } from "vitest";
import { AiRefusalError } from "@/modules/ai/errors";
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

  it("a non-retryable AI error fails the job immediately", async () => {
    const { store, id, handlers } = await setup({
      split: async () => {
        throw new AiRefusalError();
      },
    });
    const snap = await runJobStep(store, handlers, id, deps);
    expect(snap.status).toBe("failed");
    expect(snap.attempts).toBe(1);
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
