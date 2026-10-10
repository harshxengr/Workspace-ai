"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

type Document = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function WorkspacePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  const slug = params.slug;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [savingTitleId, setSavingTitleId] = useState<string | null>(null);

  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        setLoading(true);
        setError("");

        const workspaceResult = await apiFetch<{
          workspaces: Workspace[];
        }>("/api/workspaces");

        const foundWorkspace = workspaceResult.workspaces.find(
          (item) => item.slug === slug,
        );

        if (!foundWorkspace) {
          throw new Error("Workspace not found");
        }

        if (cancelled) return;

        setWorkspace(foundWorkspace);

        const documentResult = await apiFetch<{
          documents: Document[];
        }>(
          `/api/workspaces/${foundWorkspace.id}/documents`,
        );

        if (cancelled) return;

        setDocuments(documentResult.documents);
      } catch (err) {
        console.error(err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load workspace",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function createDocument() {
    if (!workspace) return;

    try {
      setCreating(true);
      setError("");

      const result = await apiFetch<{
        document: Document;
      }>(`/api/workspaces/${workspace.id}/documents`, {
        method: "POST",
        body: JSON.stringify({
          title: "Untitled document",
        }),
      });

      setDocuments((current) => [
        result.document,
        ...current,
      ]);

      router.push(
        `/workspaces/${workspace.slug}/documents/${result.document.id}`,
      );
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to create document",
      );
    } finally {
      setCreating(false);
    }
  }

  function startRename(document: Document) {
    setEditingId(document.id);
    setEditingTitle(document.title);
    setError("");
  }

  function cancelRename() {
    setEditingId(null);
    setEditingTitle("");
  }

  async function saveRename(documentId: string) {
    const nextTitle = editingTitle.trim();

    if (!nextTitle) {
      setError("Document title cannot be empty");
      return;
    }

    try {
      setSavingTitleId(documentId);
      setError("");

      const result = await apiFetch<{
        document: Document;
      }>(`/api/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: nextTitle,
        }),
      });

      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId
            ? result.document
            : document,
        ),
      );

      cancelRename();
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to rename document",
      );
    } finally {
      setSavingTitleId(null);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!workspace) return;

    const document = documents.find(
      (item) => item.id === documentId,
    );

    if (!document) return;

    const confirmed = window.confirm(
      `Delete "${document.title}"?\n\nThis action cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setDeletingId(documentId);
      setError("");

      await apiFetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });

      setDocuments((current) =>
        current.filter((item) => item.id !== documentId),
      );
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete document",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-8">
        Loading workspace...
      </main>
    );
  }

  if (error && !workspace) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-bold">
          Workspace error
        </h1>

        <p className="mt-2">{error}</p>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="min-h-screen p-8">
        Workspace not found.
      </main>
    );
  }

  return (
    <main className="flex min-h-screen">
      <aside className="w-80 border-r p-4">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm underline"
          >
            ← Dashboard
          </Link>

          <h1 className="mt-4 text-xl font-bold">
            {workspace.name}
          </h1>

          {workspace.description && (
            <p className="mt-1 text-sm">
              {workspace.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Documents
          </h2>

          <button
            type="button"
            onClick={createDocument}
            disabled={creating}
            className="rounded border px-2 py-1 text-sm"
          >
            {creating ? "Creating..." : "+ New"}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {documents.map((document) => {
            const isEditing = editingId === document.id;
            const isSaving = savingTitleId === document.id;
            const isDeleting = deletingId === document.id;

            return (
              <div
                key={document.id}
                className="rounded border p-2"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(event) =>
                        setEditingTitle(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveRename(document.id);
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      disabled={isSaving}
                      className="w-full rounded border px-2 py-1 text-sm outline-none"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void saveRename(document.id)
                        }
                        disabled={isSaving}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </button>

                      <button
                        type="button"
                        onClick={cancelRename}
                        disabled={isSaving}
                        className="rounded border px-2 py-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/workspaces/${workspace.slug}/documents/${document.id}`}
                      className="min-w-0 flex-1 truncate"
                    >
                      {document.title}
                    </Link>

                    <button
                      type="button"
                      onClick={() => startRename(document)}
                      className="text-xs"
                      title="Rename document"
                    >
                      Rename
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void deleteDocument(document.id)
                      }
                      disabled={isDeleting}
                      className="text-sm"
                      title="Delete document"
                    >
                      {isDeleting ? "..." : "×"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {documents.length === 0 && (
            <p className="text-sm">
              No documents yet.
            </p>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded border p-3 text-sm">
            {error}
          </div>
        )}
      </aside>

      <section className="flex-1 p-8">
        <h2 className="text-3xl font-bold">
          {workspace.name}
        </h2>

        <p className="mt-2">
          Select a document or create a new one.
        </p>

        {documents.length > 0 && (
          <div className="mt-8">
            <h3 className="text-xl font-semibold">
              Recent documents
            </h3>

            <div className="mt-4 space-y-2">
              {documents.map((document) => (
                <Link
                  key={document.id}
                  href={`/workspaces/${workspace.slug}/documents/${document.id}`}
                  className="block rounded border p-4"
                >
                  <div className="font-medium">
                    {document.title}
                  </div>

                  <div className="mt-1 text-sm">
                    Updated{" "}
                    {new Date(
                      document.updatedAt,
                    ).toLocaleString()}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}