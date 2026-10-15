import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/auth";

// Every page in this group is signed-in only and gets the shell.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
