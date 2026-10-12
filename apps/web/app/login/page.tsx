
"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || "Invalid email or password");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to sign in. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your WorkspaceAI account.
          </p>
        </div>

        <div className="space-y-3">
          <label htmlFor="login-email" className="sr-only">
            Email address
          </label>
          <input
            id="login-email"
            className="w-full rounded-md border p-3 text-slate-900"
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={loading}
          />

          <label htmlFor="login-password" className="sr-only">
            Password
          </label>
          <input
            id="login-password"
            className="w-full rounded-md border p-3 text-slate-900"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={loading}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <button
          className="w-full rounded-md bg-slate-950 p-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <div className="relative py-1">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white px-3 text-xs text-slate-500">
              NEW TO WORKSPACEAI?
            </span>
          </div>
        </div>

        <Link
          href="/signup"
          className="block w-full rounded-md border border-slate-300 bg-white p-3 text-center font-semibold text-slate-900 transition hover:bg-slate-50"
        >
          Create an account
        </Link>

        <p className="text-center text-xs text-slate-500">
          Create an account to start collaborating with your team.
        </p>
      </form>
    </main>
  );
}
