
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

    // Hocuspocus uses this configuration to restrict writes.
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
        // Use the authenticated identity rather than trusting the
        // name and color supplied in a client's awareness state.
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

        // Load the authoritative Yjs state when the document has
        // previously been used for collaborative editing.
        if (record.collaborationState?.byteLength) {
            const ydoc = new Y.Doc();

            Y.applyUpdate(
                ydoc,
                new Uint8Array(record.collaborationState),
            );

            return ydoc;
        }

        // Convert documents created before collaboration was added.
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

        const content = TiptapTransformer.fromYdoc(document);

        // Persist the binary Yjs state. Do not rebuild this state
        // from JSON on every connection; Yjs needs its own updates.
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

// Crossws returns a connection per WebSocket peer. Keep the
// Hocuspocus connection associated with its peer ID.
const clientConnections = new Map<
    string,
    ReturnType<typeof collaborationServer.handleConnection>
>();

const ws = crossws({
    hooks: {
        open(peer) {
            // Use peer methods instead of peer.websocket directly
            // because Bun's ServerWebSocket is a proxy.
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
