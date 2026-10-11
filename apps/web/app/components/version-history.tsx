
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";

import { apiFetch } from "../lib/api";

type Version = {
  id: string;
  content: JSONContent;
  createdAt: string;
};

type VersionHistoryProps = {
  documentId: string;
  refreshToken: number;
  canRestore: boolean;
  onBeforeRestore: () => Promise<boolean>;
  onRestore: () => void;
  onRestoreComplete: () => void;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

export default function VersionHistory({
  documentId,
  refreshToken,
  canRestore,
  onBeforeRestore,
  onRestore,
  onRestoreComplete,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Ignore responses belonging to an earlier request or document.
  const requestSequenceRef = useRef(0);

  const loadVersions = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current;

    try {
      setLoading(true);
      setError("");

      const result = await apiFetch<{ versions: Version[] }>(
        `/api/documents/${documentId}/versions`,
      );

      if (requestSequence === requestSequenceRef.current) {
        setVersions(result.versions);
      }
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) {
        setError(getErrorMessage(error));
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [documentId]);

  useEffect(() => {
    setVersions([]);
    void loadVersions();

    return () => {
      // Invalidate any request that is still in flight.
      requestSequenceRef.current += 1;
    };
  }, [loadVersions, refreshToken]);

  async function restoreVersion(version: Version) {
    const confirmed = window.confirm(
      `Restore the version from ${new Date(
        version.createdAt,
      ).toLocaleString()}?\n\nYour current document content will be replaced.`,
    );

    if (!confirmed || restoringId !== null) {
      return;
    }

    let restoreWorkflowStarted = false;

    try {
      setRestoringId(version.id);
      setError("");

      // Save pending edits and temporarily disable editing first.
      restoreWorkflowStarted = true;

      const canProceed = await onBeforeRestore();

      if (!canProceed) {
        setError(
          "Restore was cancelled because pending edits could not be saved. Retry saving, then try again.",
        );
        return;
      }

      const result = await apiFetch<{
        document: {
          content: JSONContent | null;
        };
      }>(
        `/api/documents/${documentId}/versions/${version.id}/restore`,
        {
          method: "POST",
        },
      );

      if (!result.document.content) {
        throw new Error("The restored document has no content.");
      }

      // The backend has updated the active Yjs document. Do not apply
      // the JSON through the editor again, which could create a second
      // shared-document update.
      onRestore();
    } catch (error) {
      console.error("Failed to restore document version:", error);
      setError(getErrorMessage(error));
    } finally {
      setRestoringId(null);

      if (restoreWorkflowStarted) {
        onRestoreComplete();
      }
    }
  }

  return (
    <aside className="w-80 shrink-0 border-l p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Version history</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Manually saved snapshots
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadVersions()}
          disabled={loading || restoringId !== null}
          className="rounded border px-2 py-1 text-xs disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded border p-3 text-sm">
          <p>{error}</p>

          <button
            type="button"
            onClick={() => void loadVersions()}
            disabled={loading || restoringId !== null}
            className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {loading && versions.length === 0 && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading versions...
        </p>
      )}

      {!loading && versions.length === 0 && !error && (
        <div className="mt-4 rounded border p-4 text-sm">
          <p>No snapshots yet.</p>
          <p className="mt-1 text-muted-foreground">
            Save a snapshot from the editor to preserve a version you
            can restore later.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {versions.map((version, index) => (
          <div key={version.id} className="rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                Version {versions.length - index}
              </span>

              <time
                dateTime={version.createdAt}
                className="text-xs text-muted-foreground"
              >
                {new Date(version.createdAt).toLocaleString()}
              </time>
            </div>

            <button
              type="button"
              onClick={() => void restoreVersion(version)}
              disabled={!canRestore || restoringId !== null}
              className="mt-3 rounded border px-3 py-1 text-xs disabled:opacity-50"
            >
              {restoringId === version.id ? "Restoring..." : "Restore"}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
