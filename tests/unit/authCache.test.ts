import { expect, it, vi } from "vitest";

// Item 16: getSessionUser is memoised per request with React's cache().
const cached = vi.hoisted(() => ({ wrapped: [] as unknown[], result: vi.fn() }));
vi.mock("react", () => ({
  cache: (fn: unknown) => {
    cached.wrapped.push(fn);
    return cached.result;
  },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));

it("getSessionUser is the cache()-wrapped loader", async () => {
  const { getSessionUser } = await import("@/lib/auth");
  expect(cached.wrapped).toHaveLength(1);
  expect(getSessionUser).toBe(cached.result);
});
