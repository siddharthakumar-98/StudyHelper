import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string;
  role: "student" | "admin";
};

/** Route handlers map this to HTTP 403. */
export class ForbiddenError extends Error {
  constructor(message = "Admin access required") {
    super(message);
    this.name = "ForbiddenError";
  }
}

type SessionLoader = () => Promise<SessionUser | null>;

export const getSessionUser: SessionLoader = async () => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    role: profile?.role ?? "student",
  };
};

export async function requireUser(
  load: SessionLoader = getSessionUser,
): Promise<SessionUser> {
  const user = await load();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(
  load: SessionLoader = getSessionUser,
): Promise<SessionUser> {
  const user = await requireUser(load);
  if (user.role !== "admin") throw new ForbiddenError();
  return user;
}
