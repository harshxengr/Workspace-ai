"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { apiFetch } from "../../lib/api";
import { authClient } from "../../lib/auth-client";

type InvitationDetails = {
  email: string;
  role: "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";
  expiresAt: string;
  workspace: {
    name: string;
    slug: string;
  };
  inviterName: string;
};

type CurrentUser = {
  name?: string | null;
  email: string;
};

export default function InvitationAcceptancePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      try {
        const result = await apiFetch<{
          invitation: InvitationDetails;
        }>(`/api/invitations/${encodeURIComponent(token)}`);

        if (!cancelled) {
          setInvitation(result.invitation);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "This invitation is invalid or has expired.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInvitation();

    void authClient.getSession().then(
      ({ data }) => {
        if (!cancelled && data?.user) {
          setCurrentUser({
            name: data.user.name,
            email: data.user.email,
          });
        }
      },
      () => {
        // A logged-out visitor can still view and accept a valid invitation.
      },
    );

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function acceptInvitation() {
    if (!invitation) return;

    setSubmitting(true);
    setError("");

    try {
      const result = await apiFetch<{
        workspace: {
          name: string;
          slug: string;
        };
        role: string;
      }>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      router.replace(`/workspaces/${result.workspace.slug}`);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not accept this invitation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!invitation) return;

    setSubmitting(true);
    setError("");

    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: invitation.email,
          password,
        });

        if (result.error) {
          setError(result.error.message || "Could not create your account.");
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email: invitation.email,
          password,
        });

        if (result.error) {
          setError(result.error.message || "Could not sign in.");
          return;
        }
      }

      // The browser receives the session cookie from Better Auth before
      // the acceptance request is made through the same frontend origin.
      await acceptInvitation();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function switchAccount() {
    setError("");
    await authClient.signOut();
    setCurrentUser(null);
    setPassword("");
    setMode("signin");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p role="status">Checking invitation...</p>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border p-6">
          <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This invitation may have expired, been revoked, or already been
            accepted.
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <Link href="/dashboard" className="mt-5 inline-block underline">
            Go to WorkspaceAI
          </Link>
        </div>
      </main>
    );
  }

  const sessionEmailMatches =
    currentUser?.email.trim().toLowerCase() ===
    invitation.email.trim().toLowerCase();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-5 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            WorkspaceAI invitation
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            Join {invitation.workspace.name}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {invitation.inviterName} invited you to this workspace as{" "}
            <strong>{invitation.role}</strong>.
          </p>
        </div>

        <div className="rounded-lg border p-4 text-sm">
          <p>
            <span className="text-muted-foreground">Invited email:</span>{" "}
            <strong className="break-all">{invitation.email}</strong>
          </p>
          <p className="mt-2">
            <span className="text-muted-foreground">Expires:</span>{" "}
            {new Date(invitation.expiresAt).toLocaleString()}
          </p>
        </div>

        {currentUser && sessionEmailMatches ? (
          <div className="space-y-4">
            <p className="text-sm">
              Signed in as <strong>{currentUser.email}</strong>.
            </p>

            <button
              type="button"
              onClick={() => void acceptInvitation()}
              disabled={submitting}
              className="w-full rounded-md bg-slate-950 p-3 font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Joining workspace..." : "Accept invitation"}
            </button>
          </div>
        ) : currentUser ? (
          <div className="space-y-4">
            <p className="text-sm text-red-700">
              You are signed in as {currentUser.email}. This invitation belongs
              to {invitation.email}. Switch accounts to continue.
            </p>
            <button
              type="button"
              onClick={() => void switchAccount()}
              className="w-full rounded-md border p-3 font-medium"
            >
              Switch account
            </button>
          </div>
        ) : (
          <form onSubmit={authenticate} className="space-y-4">
            <div className="flex gap-2 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                className={`flex-1 rounded-md p-2 text-sm ${
                  mode === "signup" ? "bg-slate-950 text-white" : ""
                }`}
              >
                Create account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError("");
                }}
                className={`flex-1 rounded-md p-2 text-sm ${
                  mode === "signin" ? "bg-slate-950 text-white" : ""
                }`}
              >
                Sign in
              </button>
            </div>

            <div>
              <label
                htmlFor="invited-email"
                className="mb-1 block text-sm font-medium"
              >
                Email address
              </label>
              <input
                id="invited-email"
                type="email"
                value={invitation.email}
                readOnly
                className="w-full rounded-md border bg-slate-50 p-3 text-slate-700"
              />
            </div>

            {mode === "signup" && (
              <div>
                <label
                  htmlFor="invite-name"
                  className="mb-1 block text-sm font-medium"
                >
                  Your name
                </label>
                <input
                  id="invite-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  disabled={submitting}
                  className="w-full rounded-md border p-3"
                  placeholder="Your name"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="invite-password"
                className="mb-1 block text-sm font-medium"
              >
                Password
              </label>
              <input
                id="invite-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={8}
                required
                disabled={submitting}
                className="w-full rounded-md border p-3"
                placeholder="At least 8 characters"
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
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-950 p-3 font-medium text-white disabled:opacity-50"
            >
              {submitting
                ? "Please wait..."
                : mode === "signup"
                  ? "Create account and join"
                  : "Sign in and join"}
            </button>
          </form>
        )}

        {currentUser && sessionEmailMatches && error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Invitation links are single-use and expire after seven days.
        </p>
      </div>
    </main>
  );
}
