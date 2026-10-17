import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { SupabaseJobStore } from "@/modules/jobs/store";
import { anonClient, createTestUser, resetDb, serviceClient, signedInClient } from "./helpers";

const service = serviceClient();

async function newJob(): Promise<string> {
  const { data: doc, error: docError } = await service
    .from("documents")
    .insert({ title: "Job fixture" })
    .select("id")
    .single();
  expect(docError).toBeNull();
  const { data: job, error } = await service
    .from("jobs")
    .insert({ kind: "split", document_id: doc!.id })
    .select("id")
    .single();
  expect(error).toBeNull();
  return job!.id;
}

const claim = async (id: string, lockSeconds: number) => {
  const { data, error } = await service.rpc("claim_job", {
    p_job_id: id,
    p_lock_seconds: lockSeconds,
  });
  expect(error).toBeNull();
  return data && (data as { id: string | null }).id ? data : null;
};

describe("claim_job", () => {
  beforeAll(resetDb);

  it("is exclusive", async () => {
    const id = await newJob();
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(id, 60)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("succeeds again after lock expiry", async () => {
    const id = await newJob();
    expect(await claim(id, 1)).not.toBeNull();
    expect(await claim(id, 1)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await claim(id, 60)).not.toBeNull();
  });

  it("counts attempts at claim time and fails the job on the 4th claim", async () => {
    const id = await newJob();
    for (let i = 1; i <= 3; i++) {
      const row = (await claim(id, 1)) as { attempts: number } | null;
      expect(row?.attempts).toBe(i);
      await new Promise((resolve) => setTimeout(resolve, 1100)); // lock expires; no save
    }
    expect(await claim(id, 60)).toBeNull();
    const { data } = await service.from("jobs").select("status, error, locked_until").eq("id", id).single();
    expect(data).toMatchObject({ status: "failed", locked_until: null });
    expect(data!.error).toContain("stopped unexpectedly");
  });

  it("does not claim done or failed jobs", async () => {
    const id = await newJob();
    await service.from("jobs").update({ status: "done" }).eq("id", id);
    expect(await claim(id, 60)).toBeNull();
  });

  it("is denied, along with the table, to anon and authenticated roles", async () => {
    const id = await newJob();
    const user = await createTestUser("admin");
    for (const client of [anonClient(), await signedInClient(user.email, user.password)]) {
      const rpc = await client.rpc("claim_job", { p_job_id: id, p_lock_seconds: 60 });
      expect(rpc.error).not.toBeNull();
      const read = await client.from("jobs").select("*");
      expect(read.error).not.toBeNull();
    }
  });
});

describe("SupabaseJobStore fencing", () => {
  const store = new SupabaseJobStore(service as unknown as SupabaseClient<Database>);

  it("drops a save made after the lock was lost", async () => {
    const id = await newJob();
    const first = (await store.claim(id, 1))!;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const second = (await store.claim(id, 60))!;
    expect(await store.save({ ...first, status: "done", locked_until: null }, first.locked_until)).toBe(false);
    expect((await store.get(id)).status).toBe("running");
    expect(await store.save({ ...second, step: 1, status: "pending", locked_until: null }, second.locked_until)).toBe(true);
    expect((await store.get(id)).step).toBe(1);
  });

  it("resets only a failed job", async () => {
    const id = await newJob();
    await store.claim(id, 60);
    expect(await store.reset(id)).toBe(false);
    await service.from("jobs").update({ status: "failed", locked_until: null, attempts: 3 }).eq("id", id);
    expect(await store.reset(id)).toBe(true);
    expect(await store.get(id)).toMatchObject({ status: "pending", attempts: 0 });
  });
});

describe("SupabaseJobStore.release (item 4)", () => {
  beforeAll(resetDb);

  it("clears the lock only while it is still the one that was claimed", async () => {
    const store = new SupabaseJobStore(service as SupabaseClient<Database>);
    const id = await newJob();
    const claimed = await store.claim(id, 300);
    expect(claimed?.locked_until).toBeTruthy();

    await store.release(id, "2000-01-01T00:00:00+00:00");
    expect((await store.get(id)).locked_until).not.toBeNull();

    await store.release(id, claimed!.locked_until);
    expect((await store.get(id)).locked_until).toBeNull();
  });
});
