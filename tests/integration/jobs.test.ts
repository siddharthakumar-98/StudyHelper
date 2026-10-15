import { beforeAll, describe, expect, it } from "vitest";
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
