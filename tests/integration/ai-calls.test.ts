import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, createTestUser, resetDb, serviceClient, signedInClient } from "./helpers";

const service = serviceClient();

const row = {
  task: "verify",
  model: "claude-opus-5-5",
  prompt_version: "verify@1",
  input_tokens: 1000,
  output_tokens: 500,
  cost_usd: 0.0125,
};

describe("ai_calls", () => {
  beforeAll(resetDb);

  it("accepts inserts from the service role", async () => {
    const { error } = await service.from("ai_calls").insert(row);
    expect(error).toBeNull();
    const { data } = await service.from("ai_calls").select("*");
    expect(data).toHaveLength(1);
    expect(Number(data![0].cost_usd)).toBe(0.0125);
  });

  it("denies anon and authenticated roles read and write", async () => {
    const user = await createTestUser("admin");
    const clients = [anonClient(), await signedInClient(user.email, user.password)];
    for (const client of clients) {
      const read = await client.from("ai_calls").select("*");
      expect(read.error).not.toBeNull();
      const write = await client.from("ai_calls").insert(row);
      expect(write.error).not.toBeNull();
    }
  });

  it("is emptied by test_reset_app_tables", async () => {
    await resetDb();
    const { data } = await service.from("ai_calls").select("id");
    expect(data).toEqual([]);
  });
});
