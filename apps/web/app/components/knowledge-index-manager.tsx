"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { apiFetch } from "../lib/api";

type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "EDITOR"
  | "MEMBER"
  | "VIEWER";

type IndexState =
  | "not_indexed"
  | "out_of_date"
  | "indexed"
  | "indexing"
  | "failed";

type IndexedDocument = {
  documentId: string;
  title: string;
  updatedAt: string;
  chunksIndexed: number;
  indexedAt: string | null;
  jobStatus: string | null;
  requestedHash: string | null;
  indexedHash: string | null;
  attemptCount: number | null;
  lastError: string | null;
  state: IndexState;
};

type IndexSummary = {
  totalDocuments: number;
  indexedDocuments: number;
  needsIndexing: number;
  activeDocuments: number;
  failedDocuments: number;
  totalChunks: number;
  pendingJobs: number;
  processingJobs: number;
  succeededJobs: number;
  failedJobs: number;
};

type IndexStatusResponse = {
  documents: IndexedDocument[];
  summary: IndexSummary;
};

type IndexResponse = {
  success: boolean;
  documentId: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED";
  message: string;
};

type RetryResponse = {
  success: boolean;
  status: "PENDING";
};

type KnowledgeIndexManagerProps = {
  workspaceId: string;
  workspaceSlug: string;
  currentRole: WorkspaceRole | null;
};

const STATE_LABELS: Record<IndexState, string> = {
  not_indexed: "Not indexed",
  out_of_date: "Needs re-indexing",
  indexed: "Up to date",
  indexing: "Queued / indexing",
  failed: "Indexing failed",
};

export default function KnowledgeIndexManager({
  workspaceId,
  workspaceSlug,
  currentRole,
}: KnowledgeIndexManagerProps) {
  const [documents, setDocuments] = useState<IndexedDocument[]>([]);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const canIndex =
    currentRole === "OWNER" ||
    currentRole === "ADMIN" ||
    currentRole === "EDITOR";

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await apiFetch<IndexStatusResponse>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/status`,
      );

      setDocuments(response.documents);
      setSummary(response.summary);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load indexing status.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const hasActiveJobs = documents.some(
    (document) => document.state === "indexing",
  );

  // Poll while at least one document is queued or being indexed.
  useEffect(() => {
    if (!hasActiveJobs) return;

    let active = true;

    const refreshStatus = async () => {
      try {
        const response = await apiFetch<IndexStatusResponse>(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/status`,
        );

        if (active) {
          setDocuments(response.documents);
          setSummary(response.summary);
          setError("");
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not refresh indexing status.",
          );
        }
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshStatus();
      }
    };

    const interval = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasActiveJobs, workspaceId]);

  async function runIndexAction(document: IndexedDocument) {
    if (!canIndex || workingId !== null) return;

    setWorkingId(document.documentId);
    setError("");
    setNotice("");

    try {
      if (document.state === "failed") {
        await apiFetch<RetryResponse>(
          `/api/documents/${encodeURIComponent(document.documentId)}/index/retry`,
          { method: "POST" },
        );

        setNotice(`Retry queued for "${document.title}".`);
      } else {
        const response = await apiFetch<IndexResponse>(
          `/api/documents/${encodeURIComponent(document.documentId)}/index`,
          { method: "POST" },
        );

        setNotice(
          response.status === "SUCCEEDED"
            ? `${document.title} is already indexed and up to date.`
            : `${document.title}: indexing has been queued. Status will refresh automatically.`,
        );
      }

      await loadStatus();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not index this document.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section
      aria-labelledby="knowledge-index-heading"
      className="mt-8 rounded-xl border p-5 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="knowledge-index-heading" className="text-xl font-semibold">
            Knowledge index
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Prepare documents for workspace-wide AI search and answers.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading || workingId !== null}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Refresh status
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-300 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="mt-4 rounded-md border p-3 text-sm">
          {notice}
        </div>
      )}

      {summary && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Documents", value: summary.totalDocuments },
            { label: "Up to date", value: summary.indexedDocuments },
            { label: "Needs indexing", value: summary.needsIndexing },
            { label: "Queued / running", value: summary.activeDocuments },
            { label: "Failed", value: summary.failedDocuments },
            { label: "Indexed chunks", value: summary.totalChunks },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {item.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {summary && (summary.pendingJobs > 0 || summary.processingJobs > 0 || summary.failedJobs > 0) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Queue: {summary.pendingJobs} pending, {summary.processingJobs} processing, {summary.failedJobs} failed.
        </p>
      )}

      {loading ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">
          Loading index status...
        </p>
      ) : documents.length === 0 ? (
        <p className="mt-5 text-sm text-muted-foreground">
          No documents found in this workspace yet.
        </p>
      ) : (
        <div className="mt-5 divide-y rounded-lg border">
          {documents.map((document) => {
            const isWorking = workingId === document.documentId;
            const isInProgress = document.state === "indexing";
            const isIndexed = document.state === "indexed";

            return (
              <article
                key={document.documentId}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={
                      `/workspaces/${encodeURIComponent(workspaceSlug)}` +
                      `/documents/${encodeURIComponent(document.documentId)}`
                    }
                    className="break-words font-medium underline-offset-4 hover:underline"
                  >
                    {document.title}
                  </Link>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border px-2 py-1">
                      {STATE_LABELS[document.state]}
                    </span>
                    <span className="text-muted-foreground">
                      {document.chunksIndexed} indexed chunks
                    </span>
                    {document.attemptCount !== null &&
                      document.attemptCount > 0 && (
                        <span className="text-muted-foreground">
                          {document.attemptCount} attempt
                          {document.attemptCount === 1 ? "" : "s"}
                        </span>
                      )}
                  </div>

                  {document.indexedAt && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Last indexed {new Date(document.indexedAt).toLocaleString()}
                    </p>
                  )}

                  {document.state === "failed" && document.lastError && (
                    <p className="mt-2 text-xs text-red-700">
                      Last error: {document.lastError}
                    </p>
                  )}
                </div>

                {canIndex ? (
                  isInProgress ? (
                    <span
                      role="status"
                      className="shrink-0 text-sm text-muted-foreground"
                    >
                      Indexing in background...
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void runIndexAction(document)}
                      disabled={workingId !== null || loading}
                      className="shrink-0 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isWorking
                        ? document.state === "failed"
                          ? "Queueing retry..."
                          : "Indexing..."
                        : document.state === "failed"
                          ? "Retry indexing"
                          : isIndexed
                            ? "Re-index"
                            : "Index now"}
                    </button>
                  )
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Indexing requires editor permissions
                  </span>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
