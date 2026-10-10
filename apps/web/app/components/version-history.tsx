"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "../lib/api";

type Version = {
  id: string;
  content: Record<string, unknown>;
  createdAt: string;
};

type VersionHistoryProps = {
  documentId: string;
  onRestore: (
    content: Record<string, unknown>,
  ) => void;
};

export default function VersionHistory({
  documentId,
  onRestore,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>(
    [],
  );

  const [loading, setLoading] = useState(false);

  const [restoringId, setRestoringId] = useState<
    string | null
  >(null);

  const [error, setError] = useState("");

  async function loadVersions() {
    try {
      setLoading(true);
      setError("");

      const result = await apiFetch<{
        versions: Version[];
      }>(
        `/api/documents/${documentId}/versions`,
      );

      setVersions(result.versions);
    } catch (error) {
      console.error(
        "Failed to load versions:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Failed to load version history",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVersions();
  }, [documentId]);

  async function restoreVersion(
    version: Version,
  ) {
    const confirmed = window.confirm(
      `Restore the version from ${new Date(
        version.createdAt,
      ).toLocaleString()}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setRestoringId(version.id);
      setError("");

      const result = await apiFetch<{
        document: {
          content: Record<string, unknown>;
        };
      }>(
        `/api/documents/${documentId}/versions/${version.id}/restore`,
        {
          method: "POST",
        },
      );

      onRestore(result.document.content);

      await loadVersions();
    } catch (error) {
      console.error(
        "Failed to restore version:",
        error,
      );

      setError(
        error instanceof Error
          ? error.message
          : "Failed to restore version",
      );
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <aside className="w-80 shrink-0 border-l p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">
            Version history
          </h2>

          <p className="mt-1 text-xs">
            Manual snapshots
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadVersions()}
          disabled={loading}
          className="rounded border px-2 py-1 text-xs"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border p-3 text-sm">
          {error}
        </div>
      )}

      {loading && versions.length === 0 && (
        <p className="mt-4 text-sm">
          Loading versions...
        </p>
      )}

      {!loading && versions.length === 0 && (
        <div className="mt-4 rounded border p-4 text-sm">
          <p>No snapshots yet.</p>

          <p className="mt-1">
            Click <strong>Snapshot</strong> after a
            meaningful edit to save a version.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {versions.map((version, index) => (
          <div
            key={version.id}
            className="rounded border p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Version {versions.length - index}
              </span>

              <span className="text-xs">
                {new Date(
                  version.createdAt,
                ).toLocaleString()}
              </span>
            </div>

            <button
              type="button"
              onClick={() =>
                void restoreVersion(version)
              }
              disabled={
                restoringId === version.id
              }
              className="mt-3 rounded border px-3 py-1 text-xs"
            >
              {restoringId === version.id
                ? "Restoring..."
                : "Restore"}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}