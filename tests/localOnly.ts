/**
 * Test helpers reset and seed the database they point at. They must never touch
 * a real (cloud) project, so they refuse any Supabase URL that is not the local
 * stack (R39).
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalSupabaseUrl(url: string | undefined): void {
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Tests only run against the local Supabase stack (localhost or 127.0.0.1), ` +
        `but NEXT_PUBLIC_SUPABASE_URL is "${url ?? ""}". Refusing to touch that database: ` +
        `point the test env file at \`npx supabase status\`'s API_URL.`,
    );
  }
}
