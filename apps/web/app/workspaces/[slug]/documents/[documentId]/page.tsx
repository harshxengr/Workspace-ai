"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Editor from "../../../../components/editor";
import { apiFetch } from "../../../../lib/api";

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

export default function DocumentPage() {
  const params = useParams<{
    slug: string;
    documentId: string;
  }>();

  const router = useRouter();

  const slug = params.slug;
  const documentId = params.documentId;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

        const documentResult = await apiFetch<{
          documents: Document[];
        }>(
          `/api/workspaces/${foundWorkspace.id}/documents`,
        );

        if (cancelled) return;

        setWorkspace(foundWorkspace);
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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        Loading document...
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="min-h-screen p-8">
        <h1 className="text-2xl font-bold">
          Workspace error
        </h1>

        <p className="mt-2">
          {error || "Workspace not found"}
        </p>
      </main>
    );
  }

  const currentDocument = documents.find(
    (document) => document.id === documentId,
  );

  return (
    <main className="flex min-h-screen">
      {/* Workspace sidebar */}
      <aside className="w-80 shrink-0 border-r">
        <div className="p-4">
          <Link
            href="/dashboard"
            className="text-sm"
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

        <div className="border-t p-4">
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
              {creating ? "..." : "+ New"}
            </button>
          </div>

          <div className="mt-4 space-y-1">
            {documents.map((document) => {
              const active = document.id === documentId;

              return (
                <Link
                  key={document.id}
                  href={`/workspaces/${workspace.slug}/documents/${document.id}`}
                  className={`block rounded px-3 py-2 ${
                    active
                      ? "font-semibold underline"
                      : ""
                  }`}
                >
                  <div className="truncate">
                    {document.title}
                  </div>
                </Link>
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
        </div>
      </aside>

      {/* Editor */}
      <section className="min-w-0 flex-1 p-8">
        <div className="mx-auto max-w-5xl">
          {!currentDocument && (
            <div className="mb-4 rounded border p-4">
              Loading document...
            </div>
          )}

          <Editor documentId={documentId} />
        </div>
      </section>
    </main>
  );
}