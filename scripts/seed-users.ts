import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const supabase = createClient<Database>(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
}

async function upsertUser(
  email: string,
  password: string,
  role: "student" | "admin",
): Promise<void> {
  let id = await findUserId(email);
  if (id) {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`updating ${role} failed: ${error.message}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`creating ${role} failed: ${error?.message ?? "no user"}`);
    }
    id = data.user.id;
  }
  const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
  if (error) throw new Error(`setting ${role} role failed: ${error.message}`);
  console.log(`Seeded ${role} account.`);
}

await upsertUser(env("STUDENT_EMAIL"), env("STUDENT_PASSWORD"), "student");
await upsertUser(env("ADMIN_EMAIL"), env("ADMIN_PASSWORD"), "admin");
