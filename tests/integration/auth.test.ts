import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { anonClient } from "./helpers";

describe("auth", () => {
  it("public sign-up is disabled", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: `signup-${randomUUID()}@example.test`,
      password: `pw-${randomUUID()}`,
    });
    expect(error).not.toBeNull();
    expect(data.session).toBeNull();
  });
});
