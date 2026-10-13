"use client";

import { useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import * as Y from "yjs";

import { apiFetch } from "../lib/api";
import VersionHistory from "./version-history";

type EditorProps = {
  documentId: string;
};

type ConnectionStatus = "connecting" | "connected" | "disconnected";

type CollaborationUser = {
  id: string;
  name: string;
  color: string;
};

type CollaborationAuthorization = {
  token: string;
  expiresIn: number;
  canEdit: boolean;
  user: CollaborationUser;
};

type CollaborationSession = {
  document: Y.Doc;
  provider: HocuspocusProvider;
  canEdit: boolean;
  user: CollaborationUser;
};

type DocumentResponse = {
  document: {
    id: string;
    title: string;
    content: JSONContent | null;
    updatedAt: string;
  };
};

const PERSISTENCE_ACK_TYPE = "workspace-ai:document-persisted";

type PersistenceAcknowledgement = {
  type: typeof PERSISTENCE_ACK_TYPE;
  contentHash: string;
  savedAt: string;
};

type PersistenceStatus =
  "idle" | "checking" | "saving" | "saved" | "delayed" | "unknown";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, normalizeJson(object[key])]),
    );
  }

  return value;
}

async function hashJsonContent(value: unknown): Promise<string> {
  const serialized = JSON.stringify(normalizeJson(value)) ?? "null";
  const encoded = new TextEncoder().encode(serialized);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parsePersistenceAcknowledgement(
  payload: string,
): PersistenceAcknowledgement | null {
  try {
    const parsed: unknown = JSON.parse(payload);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const message = parsed as Record<string, unknown>;

    if (
      message.type !== PERSISTENCE_ACK_TYPE ||
      typeof message.contentHash !== "string" ||
      typeof message.savedAt !== "string" ||
      Number.isNaN(Date.parse(message.savedAt))
    ) {
      return null;
    }

    return {
      type: PERSISTENCE_ACK_TYPE,
      contentHash: message.contentHash,
      savedAt: message.savedAt,
    };
  } catch {
    // Ignore malformed or unrelated stateless messages.
    return null;
  }
}

export default function Editor({ documentId }: EditorProps) {
  const [session, setSession] = useState<CollaborationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasSynced, setHasSynced] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [persistenceAcknowledgement, setPersistenceAcknowledgement] =
    useState<PersistenceAcknowledgement | null>(null);

  const authorizationPath = `/api/collaboration/documents/${documentId}/token`;

  useEffect(() => {
    let cancelled = false;
    let providerInstance: HocuspocusProvider | null = null;
    let documentInstance: Y.Doc | null = null;

    setLoading(true);
    setSession(null);
    setHasSynced(false);
    setConnectionStatus("connecting");
    setConnectionError("");
    setPersistenceAcknowledgement(null);

    async function initializeCollaboration() {
      try {
        const authorization =
          await apiFetch<CollaborationAuthorization>(authorizationPath);

        if (cancelled) {
          return;
        }

        const sharedDocument = new Y.Doc();
        documentInstance = sharedDocument;

        // Reuse the initial token once, and fetch a fresh token
        // when the provider needs to authenticate again.
        let initialToken: string | null = authorization.token;

        const provider = new HocuspocusProvider({
          url: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234",
          name: documentId,
          document: sharedDocument,

          token: async () => {
            if (initialToken) {
              const token = initialToken;
              initialToken = null;
              return token;
            }

            const refreshed = await apiFetch<{ token: string }>(
              authorizationPath,
            );

            return refreshed.token;
          },

          onStatus: ({ status }) => {
            if (cancelled) {
              return;
            }

            setConnectionStatus(status);

            if (status !== "connected") {
              setHasSynced(false);
            }
          },

          onSynced: () => {
            if (!cancelled) {
              setHasSynced(true);
            }
          },

          onStateless: ({ payload }) => {
            if (cancelled) {
              return;
            }

            const acknowledgement = parsePersistenceAcknowledgement(payload);

            if (acknowledgement) {
              setPersistenceAcknowledgement(acknowledgement);
            }
          },

          onAuthenticationFailed: ({ reason }) => {
            if (!cancelled) {
              setConnectionError(
                `Collaboration authentication failed: ${reason}`,
              );
              setLoading(false);
            }
          },
        });

        providerInstance = provider;

        if (cancelled) {
          provider.destroy();
          sharedDocument.destroy();
          return;
        }

        setSession({
          document: sharedDocument,
          provider,
          canEdit: authorization.canEdit,
          user: authorization.user,
        });

        setLoading(false);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to initialize collaboration:", error);
          setConnectionError(getErrorMessage(error));
          setLoading(false);
        }
      }
    }

    void initializeCollaboration();

    return () => {
      cancelled = true;
      providerInstance?.destroy();
      documentInstance?.destroy();
    };
  }, [authorizationPath, documentId, retryCount]);

  function retryConnection() {
    setConnectionError("");
    setSession(null);
    setLoading(true);
    setHasSynced(false);
    setRetryCount((current) => current + 1);
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-lg border p-6">
        Connecting to the collaborative document...
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="rounded-lg border p-6">
        <h2 className="text-lg font-semibold">
          Unable to connect to collaboration
        </h2>

        <p role="alert" className="mt-2 text-sm text-destructive">
          {connectionError}
        </p>

        <button
          type="button"
          onClick={retryConnection}
          className="mt-4 rounded-md border px-4 py-2"
        >
          Retry connection
        </button>
      </div>
    );
  }

  if (!session || !hasSynced) {
    return (
      <div className="rounded-lg border p-6">
        <p role="status" aria-live="polite">
          {connectionStatus === "disconnected"
            ? "The collaboration server is disconnected. Reconnecting..."
            : "Synchronizing document content..."}
        </p>

        <button
          type="button"
          onClick={retryConnection}
          className="mt-4 rounded-md border px-4 py-2"
        >
          Retry connection
        </button>
      </div>
    );
  }

  return (
    <CollaborativeDocumentEditor
      key={documentId}
      documentId={documentId}
      session={session}
      connectionStatus={connectionStatus}
      persistenceAcknowledgement={persistenceAcknowledgement}
    />
  );
}

type CollaborativeDocumentEditorProps = {
  documentId: string;
  session: CollaborationSession;
  connectionStatus: ConnectionStatus;
  persistenceAcknowledgement: PersistenceAcknowledgement | null;
};

function CollaborativeDocumentEditor({
  documentId,
  session,
  connectionStatus,
  persistenceAcknowledgement,
}: CollaborativeDocumentEditorProps) {
  const [title, setTitle] = useState("");
  const [titleLoading, setTitleLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Live collaboration connected");
  const [error, setError] = useState("");
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [loadedPersistenceSnapshot, setLoadedPersistenceSnapshot] =
    useState<PersistenceAcknowledgement | null>(null);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>("checking");

  const savedTitleRef = useRef("");
  const documentRevisionRef = useRef(0);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
        }),

        Collaboration.configure({
          document: session.document,
          field: "default",
        }),

        CollaborationCaret.configure({
          provider: session.provider,
          user: {
            name: session.user.name,
            color: session.user.color,
          },
        }),
      ],

      immediatelyRender: false,

      editable: session.canEdit && connectionStatus === "connected",

      editorProps: {
        attributes: {
          class: "tiptap min-h-[520px] outline-none",
        },
      },
    },
    [documentId, session.provider],
  );

  // Fetching the latest database content also provides a starting point
  // after a reconnect, even if a prior WebSocket acknowledgement was missed.
  useEffect(() => {
    let cancelled = false;

    async function loadDocumentTitle() {
      try {
        setTitleLoading(true);
        setError("");

        const result = await apiFetch<DocumentResponse>(
          `/api/documents/${documentId}`,
        );

        if (cancelled) {
          return;
        }

        savedTitleRef.current = result.document.title;
        setTitle(result.document.title);

        if (result.document.content !== null) {
          const contentHash = await hashJsonContent(result.document.content);

          if (cancelled) {
            return;
          }

          setLoadedPersistenceSnapshot({
            type: PERSISTENCE_ACK_TYPE,
            contentHash,
            savedAt: result.document.updatedAt,
          });
        } else {
          setPersistenceStatus("unknown");
        }
      } catch (error) {
        if (!cancelled) {
          setError(`Could not load document title: ${getErrorMessage(error)}`);
          setPersistenceStatus("unknown");
        }
      } finally {
        if (!cancelled) {
          setTitleLoading(false);
        }
      }
    }

    void loadDocumentTitle();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Acknowledge a save only if the current Tiptap JSON matches a content
  // snapshot that the server confirms was written to PostgreSQL.
  const persistenceSnapshot = !loadedPersistenceSnapshot
    ? persistenceAcknowledgement
    : !persistenceAcknowledgement
      ? loadedPersistenceSnapshot
      : Date.parse(persistenceAcknowledgement.savedAt) >=
          Date.parse(loadedPersistenceSnapshot.savedAt)
        ? persistenceAcknowledgement
        : loadedPersistenceSnapshot;

  useEffect(() => {
    if (!editor || !persistenceSnapshot) {
      return;
    }

    let cancelled = false;
    const revisionAtStart = documentRevisionRef.current;

    async function verifyPersistedContent(
      activeEditor: NonNullable<typeof editor>,
      confirmedSnapshot: PersistenceAcknowledgement,
    ): Promise<void> {
      try {
        const currentHash = await hashJsonContent(activeEditor.getJSON());

        if (cancelled || revisionAtStart !== documentRevisionRef.current) {
          return;
        }

        if (currentHash === confirmedSnapshot.contentHash) {
          setPersistenceStatus("saved");
        } else {
          setPersistenceStatus("saving");
        }
      } catch {
        if (!cancelled && revisionAtStart === documentRevisionRef.current) {
          setPersistenceStatus("unknown");
        }
      }
    }

    setPersistenceStatus("checking");
    void verifyPersistedContent(editor, persistenceSnapshot);

    return () => {
      cancelled = true;
    };
  }, [editor, persistenceSnapshot]);

  useEffect(() => {
    const handleDocumentUpdate = () => {
      documentRevisionRef.current += 1;
      setPersistenceStatus("saving");
    };

    session.document.on("update", handleDocumentUpdate);

    return () => {
      session.document.off("update", handleDocumentUpdate);
    };
  }, [session.document]);

  useEffect(() => {
    if (persistenceStatus !== "saving") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPersistenceStatus((current) =>
        current === "saving" ? "delayed" : current,
      );
    }, 10_000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [persistenceStatus]);

  useEffect(() => {
    editor?.setEditable(
      session.canEdit && connectionStatus === "connected" && !busy,
    );
  }, [editor, session.canEdit, connectionStatus, busy]);

  async function saveTitle(value: string) {
    if (!session.canEdit || connectionStatus !== "connected" || titleLoading) {
      return;
    }

    const nextTitle = value.trim();

    if (!nextTitle || nextTitle.length > 200) {
      setTitle(savedTitleRef.current);
      setError("Document title must contain 1–200 characters.");
      return;
    }

    if (nextTitle === savedTitleRef.current) {
      return;
    }

    setError("");
    setStatus("Saving title...");

    try {
      await apiFetch<{ document: { id: string } }>(
        `/api/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: nextTitle,
            createVersion: false,
          }),
        },
      );

      savedTitleRef.current = nextTitle;
      setTitle(nextTitle);
      setStatus("Title saved");
    } catch (error) {
      setTitle(savedTitleRef.current);
      setError(`Title save failed: ${getErrorMessage(error)}`);
      setStatus("Title save failed");
    }
  }

  async function createSnapshot() {
    if (
      !editor ||
      !session.canEdit ||
      connectionStatus !== "connected" ||
      busy
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Saving snapshot...");

    try {
      // Send locally buffered collaboration updates before
      // requesting the version snapshot.
      session.provider.flushPendingUpdates();

      const content: JSONContent = editor.getJSON();

      await apiFetch<{ document: { id: string } }>(
        `/api/documents/${documentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            content,
            createVersion: true,
          }),
        },
      );

      setHistoryRefreshToken((current) => current + 1);
      setStatus("Snapshot saved");
    } catch (error) {
      console.error("Snapshot creation failed:", error);
      setError(`Snapshot failed: ${getErrorMessage(error)}`);
      setStatus("Snapshot failed");
    } finally {
      setBusy(false);
    }
  }

  async function prepareRestore(): Promise<boolean> {
    if (
      !session.canEdit ||
      connectionStatus !== "connected" ||
      !editor ||
      busy
    ) {
      setError(
        "Reconnect to the collaboration server before restoring a version.",
      );
      return false;
    }

    setBusy(true);
    setError("");
    setStatus("Preparing to restore version...");

    session.provider.flushPendingUpdates();

    return true;
  }

  function handleRestoreComplete() {
    setBusy(false);
  }

  function handleRestoredContent() {
    // The backend updates and persists the active Yjs document.
    // Applying setContent here would duplicate the restoration.
    setStatus("Version restored and synchronizing collaborators");
    setHistoryRefreshToken((current) => current + 1);
  }

  if (!editor) {
    return (
      <div className="rounded-lg border p-6">
        Initializing the collaborative editor...
      </div>
    );
  }

  const canInteract =
    session.canEdit && connectionStatus === "connected" && !busy;

  let persistenceLabel: string;

  switch (persistenceStatus) {
    case "saved":
      persistenceLabel = persistenceSnapshot
        ? `Saved to database at ${new Date(
            persistenceSnapshot.savedAt,
          ).toLocaleTimeString()}`
        : "Saved to database";
      break;
    case "saving":
      persistenceLabel = "Saving changes...";
      break;
    case "delayed":
      persistenceLabel = "Save confirmation is taking longer than expected";
      break;
    case "checking":
      persistenceLabel = "Checking saved state...";
      break;
    case "unknown":
      persistenceLabel = "Save status unavailable";
      break;
    default:
      persistenceLabel = "Autosave ready";
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                connectionStatus === "connected" ? "bg-green-500" : "bg-red-500"
              }`}
              aria-hidden="true"
            />

            <span role="status" className="text-sm">
              {connectionStatus === "connected"
                ? "Connected · Live collaboration"
                : connectionStatus === "connecting"
                  ? "Reconnecting..."
                  : "Offline · Editing disabled"}
            </span>
          </div>

          <span
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            {persistenceLabel}
          </span>
        </div>

        <span className="rounded-full border px-3 py-1 text-xs">
          {session.canEdit ? "Editor access" : "Read-only access"}
        </span>
      </div>

      <div className="flex min-w-0">
        <section className="min-w-0 flex-1 p-6">
          <label htmlFor="collaborative-document-title" className="sr-only">
            Document title
          </label>

          <input
            id="collaborative-document-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={(event) => {
              void saveTitle(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            disabled={!canInteract || titleLoading}
            maxLength={200}
            placeholder="Untitled document"
            className="mb-4 w-full bg-transparent text-3xl font-bold outline-none disabled:opacity-70"
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={!canInteract}
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              B
            </button>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={!canInteract}
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              I
            </button>

            <button
              type="button"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
              disabled={!canInteract}
              aria-label="Heading 1"
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              H1
            </button>

            <button
              type="button"
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              disabled={!canInteract}
              aria-label="Heading 2"
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              H2
            </button>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              disabled={!canInteract}
              aria-label="Bullet list"
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              List
            </button>

            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              disabled={!canInteract}
              aria-label="Numbered list"
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              1.
            </button>

            <button
              type="button"
              onClick={() => void createSnapshot()}
              disabled={!canInteract}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              {busy ? "Please wait..." : "Save snapshot"}
            </button>

            <span
              role="status"
              aria-live="polite"
              className="ml-auto text-sm text-muted-foreground"
            >
              {status}
            </span>
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded border p-3 text-sm">
              {error}
            </div>
          )}

          <div className="min-h-[550px] rounded border p-5">
            <EditorContent editor={editor} />
          </div>
        </section>

        <VersionHistory
          documentId={documentId}
          refreshToken={historyRefreshToken}
          canRestore={canInteract}
          onBeforeRestore={prepareRestore}
          onRestore={handleRestoredContent}
          onRestoreComplete={handleRestoreComplete}
        />
      </div>
    </div>
  );
}
