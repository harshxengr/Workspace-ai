import { Router } from "express";
import { z } from "zod";

import { prisma } from "@workspace/db";
import { requireAuth } from "@workspace/auth";

const router = Router();

type WorkspaceRole =
  | "OWNER"
  | "ADMIN"
  | "EDITOR"
  | "MEMBER"
  | "VIEWER";

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.unknown().optional(),
  createVersion: z.boolean().optional(),
});

async function getMembership(
  workspaceId: string,
  userId: string,
) {
  return prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
  });
}

function canCreateDocument(role: WorkspaceRole) {
  return role !== "VIEWER";
}

function canEditDocument(role: WorkspaceRole) {
  return (
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "EDITOR"
  );
}

function canDeleteDocument(role: WorkspaceRole) {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Create a document
 *
 * POST /workspaces/:workspaceId/documents
 *
 * OWNER/ADMIN/EDITOR/MEMBER can create.
 * VIEWER cannot create.
 */
router.post(
  "/workspaces/:workspaceId/documents",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const { workspaceId } = req.params;

      const parsed = createDocumentSchema.safeParse(
        req.body,
      );

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid document data",
          details: parsed.error.flatten(),
        });
      }

      const membership = await getMembership(
        workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "You are not a workspace member",
        });
      }

      if (
        !canCreateDocument(
          membership.role as WorkspaceRole,
        )
      ) {
        return res.status(403).json({
          error: "Insufficient permissions",
        });
      }

      const document = await prisma.document.create({
        data: {
          title: parsed.data.title,
          workspaceId,
          authorId: session.user.id,
          content: {
            type: "doc",
            content: [],
          },
        },
      });

      return res.status(201).json({
        document,
      });
    } catch (error) {
      console.error(
        "Create document failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to create document",
      });
    }
  },
);

/**
 * List workspace documents
 *
 * GET /workspaces/:workspaceId/documents
 *
 * Any workspace member can read.
 */
router.get(
  "/workspaces/:workspaceId/documents",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const { workspaceId } = req.params;

      const membership = await getMembership(
        workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "You are not a workspace member",
        });
      }

      const documents =
        await prisma.document.findMany({
          where: {
            workspaceId,
          },
          orderBy: {
            updatedAt: "desc",
          },
        });

      return res.json({
        documents,
      });
    } catch (error) {
      console.error(
        "List documents failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to fetch documents",
      });
    }
  },
);

/**
 * Get a single document
 *
 * GET /documents/:documentId
 *
 * Any workspace member can read.
 */
router.get(
  "/documents/:documentId",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const { documentId } = req.params;

      const document =
        await prisma.document.findUnique({
          where: {
            id: documentId,
          },
        });

      if (!document) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const membership = await getMembership(
        document.workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      return res.json({
        document,
      });
    } catch (error) {
      console.error(
        "Get document failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to fetch document",
      });
    }
  },
);

/**
 * Update a document
 *
 * PATCH /documents/:documentId
 *
 * OWNER/ADMIN/EDITOR can edit.
 * MEMBER/VIEWER cannot edit.
 *
 * createVersion=true creates a manual version snapshot.
 * createVersion=false only updates the current document.
 */
router.patch(
  "/documents/:documentId",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const { documentId } = req.params;

      const parsed =
        updateDocumentSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid document data",
          details: parsed.error.flatten(),
        });
      }

      const {
        title,
        content,
        createVersion = false,
      } = parsed.data;

      if (
        title === undefined &&
        content === undefined
      ) {
        return res.status(400).json({
          error: "No fields provided for update",
        });
      }

      if (
        createVersion &&
        content === undefined
      ) {
        return res.status(400).json({
          error:
            "Version snapshots require document content",
        });
      }

      const document =
        await prisma.document.findUnique({
          where: {
            id: documentId,
          },
        });

      if (!document) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const membership = await getMembership(
        document.workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      if (
        !canEditDocument(
          membership.role as WorkspaceRole,
        )
      ) {
        return res.status(403).json({
          error: "Insufficient permissions",
        });
      }

      const updated =
        await prisma.$transaction(async (tx) => {
          const updatedDocument =
            await tx.document.update({
              where: {
                id: document.id,
              },

              data: {
                ...(title !== undefined
                  ? {
                      title,
                    }
                  : {}),

                ...(content !== undefined
                  ? {
                      content: JSON.parse(
                        JSON.stringify(content),
                      ),
                    }
                  : {}),
              },
            });

          if (
            createVersion &&
            content !== undefined
          ) {
            await tx.documentVersion.create({
              data: {
                documentId: document.id,

                content: JSON.parse(
                  JSON.stringify(content),
                ),
              },
            });
          }

          return updatedDocument;
        });

      return res.json({
        document: updated,
      });
    } catch (error) {
      console.error(
        "Update document failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to update document",
      });
    }
  },
);

/**
 * Delete a document
 *
 * DELETE /documents/:documentId
 *
 * Only OWNER/ADMIN can delete.
 */
router.delete(
  "/documents/:documentId",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const { documentId } = req.params;

      const document =
        await prisma.document.findUnique({
          where: {
            id: documentId,
          },
        });

      if (!document) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const membership = await getMembership(
        document.workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      if (
        !canDeleteDocument(
          membership.role as WorkspaceRole,
        )
      ) {
        return res.status(403).json({
          error:
            "Only workspace owners and admins can delete documents",
        });
      }

      await prisma.document.delete({
        where: {
          id: documentId,
        },
      });

      return res.status(204).send();
    } catch (error) {
      console.error(
        "Delete document failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to delete document",
      });
    }
  },
);

/**
 * Get document version history
 *
 * GET /documents/:documentId/versions
 *
 * Any workspace member can read history.
 */
router.get(
  "/documents/:documentId/versions",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const document =
        await prisma.document.findUnique({
          where: {
            id: req.params.documentId,
          },

          select: {
            id: true,
            workspaceId: true,
          },
        });

      if (!document) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const membership = await getMembership(
        document.workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      const versions =
        await prisma.documentVersion.findMany({
          where: {
            documentId: document.id,
          },

          orderBy: {
            createdAt: "desc",
          },

          select: {
            id: true,
            content: true,
            createdAt: true,
          },
        });

      return res.json({
        versions,
      });
    } catch (error) {
      console.error(
        "Get document versions failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to fetch document versions",
      });
    }
  },
);

/**
 * Restore a document version
 *
 * POST /documents/:documentId/versions/:versionId/restore
 *
 * OWNER/ADMIN/EDITOR can restore.
 * MEMBER/VIEWER cannot restore.
 *
 * Restoring creates a new version so the operation
 * itself is recoverable.
 */
router.post(
  "/documents/:documentId/versions/:versionId/restore",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);

      const document =
        await prisma.document.findUnique({
          where: {
            id: req.params.documentId,
          },

          select: {
            id: true,
            workspaceId: true,
          },
        });

      if (!document) {
        return res.status(404).json({
          error: "Document not found",
        });
      }

      const membership = await getMembership(
        document.workspaceId,
        session.user.id,
      );

      if (!membership) {
        return res.status(403).json({
          error: "Access denied",
        });
      }

      if (
        !canEditDocument(
          membership.role as WorkspaceRole,
        )
      ) {
        return res.status(403).json({
          error: "Insufficient permissions",
        });
      }

      const version =
        await prisma.documentVersion.findFirst({
          where: {
            id: req.params.versionId,
            documentId: document.id,
          },

          select: {
            id: true,
            content: true,
          },
        });

      if (!version) {
        return res.status(404).json({
          error: "Version not found",
        });
      }

      const restored =
        await prisma.$transaction(async (tx) => {
          const updatedDocument =
            await tx.document.update({
              where: {
                id: document.id,
              },

              data: {
                content: JSON.parse(
                  JSON.stringify(version.content),
                ),
              },
            });

          await tx.documentVersion.create({
            data: {
              documentId: document.id,

              content: JSON.parse(
                JSON.stringify(version.content),
              ),
            },
          });

          return updatedDocument;
        });

      return res.json({
        document: restored,
      });
    } catch (error) {
      console.error(
        "Restore document version failed:",
        error,
      );

      if (
        error instanceof Error &&
        error.message === "UNAUTHORIZED"
      ) {
        return res.status(401).json({
          error: "Unauthorized",
        });
      }

      return res.status(500).json({
        error: "Failed to restore document version",
      });
    }
  },
);

export default router;