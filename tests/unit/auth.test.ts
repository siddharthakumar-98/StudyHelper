import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));

const { ForbiddenError, requireAdmin, requireUser } = await import("@/lib/auth");

const student = { id: "u1", email: "s@example.test", role: "student" } as const;
const admin = { id: "u2", email: "a@example.test", role: "admin" } as const;

describe("auth guards", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("requireAdmin throws ForbiddenError for a student", async () => {
    await expect(requireAdmin(async () => student)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("requireAdmin returns the user for an admin", async () => {
    await expect(requireAdmin(async () => admin)).resolves.toEqual(admin);
  });

  it("requireUser redirects when there is no session", async () => {
    await expect(requireUser(async () => null)).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
