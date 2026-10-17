import { describe, expect, it } from "vitest";
import { assertLocalSupabaseUrl } from "../../localOnly";

describe("assertLocalSupabaseUrl", () => {
  it("accepts the local Supabase stack", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://localhost:54321/"]) {
      expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
    }
  });

  it("refuses a cloud project, with a clear message", () => {
    expect(() => assertLocalSupabaseUrl("https://abcd1234.supabase.co")).toThrow(
      /only run against the local Supabase stack.*abcd1234\.supabase\.co/,
    );
  });

  it("refuses look-alike hosts and missing or broken URLs", () => {
    for (const url of [
      "https://localhost.evil.example",
      "https://127.0.0.1.nip.io",
      "",
      undefined,
      "not a url",
    ]) {
      expect(() => assertLocalSupabaseUrl(url)).toThrow(/local Supabase stack/);
    }
  });
});
