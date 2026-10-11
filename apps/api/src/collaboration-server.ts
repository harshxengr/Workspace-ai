
import "dotenv/config";

import {
    Hocuspocus,
    type WebSocketLike,
} from "@hocuspocus/server";
import { TiptapTransformer } from "@hocuspocus/transformer";
import crossws from "crossws/adapters/bun";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import * as Y from "yjs";

import { prisma } from "@workspace/db";
import { verifyCollaborationToken } from "@workspace/auth";

import {
    canEditDocument,
    type WorkspaceRole,
} from "./lib/document-permissions";

const EMPTY_DOCUMENT: JSONContent = {
    type: "doc",
    content: [],
};

type ConnectionConfig = {
    readOnly: boolean;
};

async function authorizeConnection(
    token: string,
    documentName: string,
    connectionConfig: ConnectionConfig,
) {
    const claims = await verifyCollaborationToken(token);

    if (claims.documentId !== documentName) {
        throw new Error("Token is not valid for this document");
    }

    const document = await prisma.document.findUnique({
        where: {
            id: documentName,
        },
        select: {
            id: true,
            workspaceId: true,
        },
    });

    if (!document) {
        throw new Error("Document not found");
    }

    const membership = await prisma.workspaceMember.findUnique({
        where: {
            workspaceId_userId: {
                workspaceId: document.workspaceId,
                userId: claims.userId,
            },
        },
        select: {
            role: true,
        },
    });

    if (!membership) {
        throw new Error("Workspace membership required");
    }

    connectionConfig.readOnly = !canEditDocument(
        membership.role as WorkspaceRole,
    );

    return {
        user: {
            id: claims.userId,
            name: claims.name,
            color: claims.color,
        },
        workspaceRole: membership.role,
    };
}

const collaborationServer = new Hocuspocus({
    debounce: 1000,
    maxDebounce: 5000,

    async onAuthenticate({
        token,
        documentName,
        connectionConfig,
    }) {
        if (!token) {
            throw new Error("Authentication required");
        }

        return authorizeConnection(
            token,
            documentName,
            connectionConfig,
        );
    },

    async beforeHandleAwareness({ states, context }) {
        // Trust the authenticated identity, not client-supplied
        // awareness names and colors.
        const trustedUser = context?.user ?? null;

        for (const state of states.values()) {
            state.user = trustedUser;
        }
    },

    async onLoadDocument({ documentName }) {
        const record = await prisma.document.findUnique({
            where: {
                id: documentName,
            },
            select: {
                content: true,
                collaborationState: true,
            },
        });

        if (!record) {
            throw new Error("Document not found");
        }

        // Use the stored binary Yjs state as the authoritative
        // collaborative document when it exists.
        if (record.collaborationState?.byteLength) {
            const ydoc = new Y.Doc();

            Y.applyUpdate(
                ydoc,
                new Uint8Array(record.collaborationState),
            );

            return ydoc;
        }

        // Initialize collaboration for documents created before
        // binary Yjs state persistence was introduced.
        const content =
            (record.content as JSONContent | null) ?? EMPTY_DOCUMENT;

        return TiptapTransformer.toYdoc(
            content,
            "default",
            [StarterKit.configure({ undoRedo: false })],
        );
    },

    async onStoreDocument({ documentName, document }) {
        const exists = await prisma.document.findUnique({
            where: {
                id: documentName,
            },
            select: {
                id: true,
            },
        });

        if (!exists) {
            return;
        }

        // IMPORTANT: specify "default".
        // Without a field name, fromYdoc() can return an object
        // containing every shared field instead of a single Tiptap
        // JSONContent document. That makes JSON and Yjs persistence
        // inconsistent with the version-restoration helper.
        const content = TiptapTransformer.fromYdoc(
            document,
            "default",
        ) as JSONContent;

        const collaborationState = Uint8Array.from(
            Y.encodeStateAsUpdate(document),
        );

        await prisma.document.update({
            where: {
                id: documentName,
            },
            data: {
                content: JSON.parse(JSON.stringify(content)),
                collaborationState,
            },
        });
    },
});

// Crossws returns a connection per WebSocket peer.
// Keep the Hocuspocus connection associated with its peer ID.
const clientConnections = new Map<
    string,
    ReturnType<typeof collaborationServer.handleConnection>
>();

const ws = crossws({
    hooks: {
        open(peer) {
            const wsLike: WebSocketLike = {
                get readyState() {
                    return peer.websocket.readyState ?? 3;
                },

                send(data) {
                    peer.send(data as never);
                },

                close(code?: number, reason?: string) {
                    peer.close(code, reason);
                },
            };

            const clientConnection =
                collaborationServer.handleConnection(
                    wsLike,
                    peer.request as Request,
                );

            clientConnections.set(peer.id, clientConnection);
        },

        message(peer, message) {
            clientConnections
                .get(peer.id)
                ?.handleMessage(message.uint8Array());
        },

        close(peer, event) {
            clientConnections
                .get(peer.id)
                ?.handleClose({
                    code: event.code ?? 1000,
                    reason: event.reason ?? "",
                });

            clientConnections.delete(peer.id);
        },

        error(peer, error) {
            console.error("Collaboration WebSocket error:", peer.id);
            console.error(error);
        },
    },
});

/**
 * Recursively normalize JSON object keys for structural comparison.
 * Array order is intentionally preserved.
 */
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

function sameJson(left: unknown, right: unknown): boolean {
    return (
        JSON.stringify(normalizeJson(left)) ===
        JSON.stringify(normalizeJson(right))
    );
}

type SaveRecoverySnapshot = (
    content: JSONContent,
) => Promise<void>;

/**
 * Restore a snapshot through the active Hocuspocus document.
 *
 * Connected collaborators receive the restoration through Yjs.
 * The Hocuspocus store hook persists both the JSON and binary state.
 */
export async function restoreCollaborativeDocument(
    documentId: string,
    restoredContent: JSONContent,
    saveRecoverySnapshot: SaveRecoverySnapshot,
): Promise<void> {
    const replacementDocument = TiptapTransformer.toYdoc(
        restoredContent,
        "default",
        [StarterKit.configure({ undoRedo: false })],
    );

    // Keep this outside the try block because it is used after
    // the direct connection closes to verify persisted state.
    const expectedContent = TiptapTransformer.fromYdoc(
        replacementDocument,
        "default",
    ) as JSONContent;

    let directConnection:
        | Awaited<
            ReturnType<typeof collaborationServer.openDirectConnection>
        >
        | null = null;

    try {
        directConnection =
            await collaborationServer.openDirectConnection(documentId, {
                operation: "version-restore",
            });

        const activeDocument = directConnection.document;

        if (!activeDocument) {
            throw new Error(
                "The collaborative document connection is already closed.",
            );
        }

        // Read the current live document so restoration is recoverable.
        const previousContent = TiptapTransformer.fromYdoc(
            activeDocument,
            "default",
        ) as JSONContent;

        await saveRecoverySnapshot(previousContent);

        const replacementFragment =
            replacementDocument.getXmlFragment("default");

        const replacementNodes: (Y.XmlElement | Y.XmlText)[] =
            replacementFragment.toArray().map((node) => {
                if (
                    node instanceof Y.XmlElement ||
                    node instanceof Y.XmlText
                ) {
                    return node.clone();
                }

                throw new Error(
                    "Unsupported Yjs XML node in restored content.",
                );
            });

        // Apply the snapshot to the active document, not a separate
        // Y.Doc, so the live Hocuspocus clients receive the update.
        await directConnection.transact((document) => {
            const fragment = document.getXmlFragment("default");

            if (fragment.length > 0) {
                fragment.delete(0, fragment.length);
            }

            if (replacementNodes.length > 0) {
                fragment.insert(0, replacementNodes);
            }
        });

        const activeContent = TiptapTransformer.fromYdoc(
            activeDocument,
            "default",
        ) as JSONContent;

        if (!sameJson(activeContent, expectedContent)) {
            throw new Error(
                "The active collaborative document does not match the requested restored content.",
            );
        }
    } finally {
        try {
            if (directConnection) {
                // Hocuspocus persists the document on direct disconnect.
                await directConnection.disconnect();
            }
        } finally {
            replacementDocument.destroy();
        }
    }

    // Read back both representations after the store hook completes.
    const persisted = await prisma.document.findUnique({
        where: {
            id: documentId,
        },
        select: {
            content: true,
            collaborationState: true,
        },
    });

    if (!persisted) {
        throw new Error(
            "The document disappeared during version restoration.",
        );
    }

    if (!persisted.collaborationState?.byteLength) {
        throw new Error(
            "The collaborative state was not persisted after restoration.",
        );
    }

    const persistedDocument = new Y.Doc();

    try {
        Y.applyUpdate(
            persistedDocument,
            new Uint8Array(persisted.collaborationState),
        );

        const persistedYjsContent = TiptapTransformer.fromYdoc(
            persistedDocument,
            "default",
        ) as JSONContent;

        if (
            !sameJson(persisted.content, expectedContent) ||
            !sameJson(persistedYjsContent, expectedContent)
        ) {
            throw new Error(
                "The restored JSON and Yjs state do not match in PostgreSQL.",
            );
        }
    } finally {
        persistedDocument.destroy();
    }
}

export async function startCollaborationServer() {
    const port = Number(process.env.COLLAB_PORT ?? 1234);

    Bun.serve({
        port,
        websocket: ws.websocket,

        fetch(request, server) {
            if (request.headers.get("upgrade") === "websocket") {
                return ws.handleUpgrade(request, server);
            }

            return new Response(
                "WorkspaceAI collaboration server is running.",
                {
                    status: 200,
                },
            );
        },
    });

    console.log(
        `WorkspaceAI collaboration server listening on port ${port}`,
    );
}
