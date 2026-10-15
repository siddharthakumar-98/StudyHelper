import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { NavTabs } from "./NavTabs";
import { TextScaleControl } from "./TextScaleControl";

async function signOut() {
  "use server";
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Wraps every signed-in page: account bar, navigation and the page itself. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="lg:flex lg:min-h-screen">
      <aside className="lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-72 lg:shrink-0 lg:flex-col lg:border-r lg:border-zinc-300">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-300 px-4 py-3 lg:flex-col lg:items-stretch lg:border-b-0 lg:px-5 lg:pt-6">
          <p className="text-xl font-bold text-blue-900">StudyHelper</p>
          <p className="min-w-0 truncate text-sm text-zinc-700 lg:order-last">
            {user.email}
          </p>
          <div className="flex items-center gap-2 lg:order-last lg:flex-wrap">
            <TextScaleControl />
            <form action={signOut}>
              <button
                type="submit"
                className="tap rounded-lg border-2 border-zinc-700 bg-white px-4 font-semibold text-zinc-900 hover:bg-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <NavTabs />
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-28 pt-6 lg:px-10 lg:pb-10">{children}</main>
    </div>
  );
}
