"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Lets tests (and nothing else) know the form is interactive.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { error: signInError } = await createBrowserSupabase().auth.signInWithPassword(
      { email, password },
    );
    if (signInError) {
      setError("Email or password is incorrect");
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  const inputClass =
    "min-h-12 w-full rounded-lg border border-zinc-500 bg-white px-4 text-lg text-zinc-950";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <form
        onSubmit={onSubmit}
        data-hydrated={hydrated ? "true" : "false"}
        className="flex flex-col gap-5"
      >
        <label className="flex flex-col gap-2 text-lg">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-2 text-lg">
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-lg font-medium text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-lg bg-blue-800 px-6 text-lg font-semibold text-white disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
