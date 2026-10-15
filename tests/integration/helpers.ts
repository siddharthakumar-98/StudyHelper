import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name} (see .env.test.local)`);
  return value;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient(): SupabaseClient {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    clientOptions,
  );
}

export function anonClient(): SupabaseClient {
  return createClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    clientOptions,
  );
}

export async function signedInClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

/** Truncates every app table except profiles (and auth). Service role only. */
export async function resetDb(): Promise<void> {
  const { error } = await serviceClient().rpc("test_reset_app_tables");
  if (error) throw new Error(`resetDb failed: ${error.message}`);
}

export async function createTestUser(
  role: "student" | "admin",
): Promise<{ email: string; password: string; id: string }> {
  const service = serviceClient();
  const email = `test-${role}-${randomUUID()}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser failed: ${error?.message ?? "no user returned"}`);
  }
  const { error: roleError } = await service
    .from("profiles")
    .update({ role })
    .eq("id", data.user.id);
  if (roleError) throw new Error(`setting role failed: ${roleError.message}`);
  return { email, password, id: data.user.id };
}
