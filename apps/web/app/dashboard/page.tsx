
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";
import { apiFetch } from "../lib/api";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt?: string;
};

type SessionUser = {
  name?: string | null;
  email: string;
};

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoadError("");

    try {
      const result = await apiFetch<{ workspaces: Workspace[] }>(
        "/api/workspaces",
      );

      setWorkspaces(result.workspaces);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load your workspaces.",
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initializeDashboard() {
      try {
        const { data, error } = await authClient.getSession();

        if (cancelled) return;

        if (error || !data?.user) {
          router.replace("/login");
          return;
        }

        setUser({
          name: data.user.name,
          email: data.user.email,
        });

        try {
          const result = await apiFetch<{
            workspaces: Workspace[];
          }>("/api/workspaces");

          if (!cancelled) {
            setWorkspaces(result.workspaces);
          }
        } catch (error) {
          if (!cancelled) {
            setLoadError(
              error instanceof Error
                ? error.message
                : "Could not load your workspaces.",
            );
          }
        }
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initializeDashboard();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (trimmedName.length < 2) {
      setCreateError("Workspace name must contain at least 2 characters.");
      return;
    }

    if (trimmedName.length > 100) {
      setCreateError("Workspace name cannot exceed 100 characters.");
      return;
    }

    if (trimmedDescription.length > 500) {
      setCreateError("Description cannot exceed 500 characters.");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const result = await apiFetch<{ workspace: Workspace }>(
        "/api/workspaces",
        {
          method: "POST",
          body: JSON.stringify({
            name: trimmedName,
            description: trimmedDescription || undefined,
          }),
        },
      );

      setWorkspaces((current) => [
        result.workspace,
        ...current.filter((item) => item.id !== result.workspace.id),
      ]);

      setName("");
      setDescription("");
      setShowCreate(false);

      router.push(`/workspaces/${result.workspace.slug}`);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Could not create the workspace. Please try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function signOut() {
    setSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setLoadError(result.error.message || "Could not sign out.");
        setSigningOut(false);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch {
      setLoadError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p role="status" aria-live="polite">
          Loading your WorkspaceAI dashboard...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <div>
            <Link href="/" className="text-sm underline">
              WorkspaceAI
            </Link>

            <h1 className="mt-3 text-3xl font-bold">
              Welcome{user.name ? `, ${user.name}` : ""}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Your workspaces</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Organize your documents and collaborate with your team.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreateError("");
                setShowCreate((current) => !current);
              }}
              className="rounded-md bg-black px-4 py-2 text-white"
            >
              {showCreate ? "Cancel" : "+ New workspace"}
            </button>
          </div>

          {loadError && (
            <div
              role="alert"
              className="mt-5 rounded-md border p-4 text-sm"
            >
              <p>{loadError}</p>

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void loadWorkspaces()}
                  className="rounded-md border px-3 py-1"
                >
                  Retry loading
                </button>

                <button
                  type="button"
                  onClick={() => setLoadError("")}
                  className="rounded-md border px-3 py-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {showCreate && (
            <form
              onSubmit={createWorkspace}
              className="mt-6 space-y-4 rounded-xl border p-5"
            >
              <h3 className="text-lg font-semibold">
                Create a workspace
              </h3>

              <div>
                <label
                  htmlFor="workspace-name"
                  className="mb-1 block text-sm font-medium"
                >
                  Workspace name
                </label>

                <input
                  id="workspace-name"
                  autoFocus
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Product team"
                  className="w-full rounded-md border p-3"
                  disabled={creating}
                />
              </div>

              <div>
                <label
                  htmlFor="workspace-description"
                  className="mb-1 block text-sm font-medium"
                >
                  Description (optional)
                </label>

                <textarea
                  id="workspace-description"
                  maxLength={500}
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="What will this workspace be used for?"
                  className="w-full rounded-md border p-3"
                  disabled={creating}
                />

                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {description.length}/500
                </p>
              </div>

              {createError && (
                <p role="alert" className="text-sm text-destructive">
                  {createError}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={creating || name.trim().length < 2}
                  className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create workspace"}
                </button>

                <button
                  type="button"
                  disabled={creating}
                  onClick={() => {
                    setShowCreate(false);
                    setCreateError("");
                    setName("");
                    setDescription("");
                  }}
                  className="rounded-md border px-4 py-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {!loadError && workspaces.length === 0 && (
            <div className="mt-6 rounded-xl border p-8 text-center">
              <h3 className="text-lg font-semibold">
                Your workspace starts here
              </h3>

              <p className="mt-2 text-sm text-muted-foreground">
                Create a workspace to start organizing documents.
              </p>

              {!showCreate && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-5 rounded-md bg-black px-4 py-2 text-white"
                >
                  Create your first workspace
                </button>
              )}
            </div>
          )}

          {workspaces.length > 0 && (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={`/workspaces/${workspace.slug}`}
                  className="group rounded-xl border p-5 transition hover:bg-muted"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold group-hover:underline">
                      {workspace.name}
                    </h3>

                    <span aria-hidden="true">↗</span>
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground">
                    {workspace.description || "No description added."}
                  </p>

                  <p className="mt-5 text-xs text-muted-foreground">
                    Open workspace →
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
