import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resetDb, serviceClient } from "./helpers";

/** The local stack's database container (supabase/config.toml project_id). */
function dbContainer(): string {
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
  if (!id) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${id}`;
}

/** Runs SQL as postgres inside the local database container; returns stdout+stderr and the exit code. */
function psql(sql: string): { out: string; code: number } {
  try {
    const out = execFileSync(
      "docker",
      ["exec", dbContainer(), "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

describe("test_reset_app_tables guard (R39)", () => {
  it("runs on the local stack, where app.allow_test_reset is on", async () => {
    await expect(resetDb()).resolves.toBeUndefined();
    const { data, error } = await serviceClient().from("documents").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("is enabled for the local database by supabase/seed.sql", () => {
    const { out, code } = psql("select value from test_support.settings where name = 'allow_test_reset'");
    expect(code).toBe(0);
    expect(out).toMatch(/\bon\b/);
  });

  // Each case runs in a transaction that is rolled back, so the opt-in survives.
  it("refuses to wipe anything when allow_test_reset is not on", () => {
    const { out, code } = psql(
      "begin; update test_support.settings set value = 'off' where name = 'allow_test_reset'; select public.test_reset_app_tables(); rollback;",
    );
    expect(code).not.toBe(0);
    expect(out).toContain("test_reset_app_tables is disabled");
  });

  it("also refuses when the opt-in is missing entirely (as on the cloud project)", () => {
    const { out, code } = psql(
      "begin; delete from test_support.settings; select public.test_reset_app_tables(); rollback;",
    );
    expect(code).not.toBe(0);
    expect(out).toContain("test_reset_app_tables is disabled");
  });

  it("cannot be switched on through the Data API, even with the service role", async () => {
    const service = serviceClient();
    const { error } = await service.schema("test_support" as "public").from("settings" as never).select("*");
    expect(error).not.toBeNull();
  });
});
