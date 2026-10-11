import { Router } from "express";

import { prisma } from "@workspace/db";
import {
  createCollaborationToken,
  getCollaborationColor,
  requireAuth,
} from "@workspace/auth";

import {
  canEditDocument,
  type WorkspaceRole,
} from "../lib/document-permissions";

const router = Router();

router.get("/documents/:documentId/token", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const documentId = req.params.documentId;

    if (!documentId) {
      return res.status(400).json({
        error: "Document ID is required",
      });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
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

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: document.workspaceId,
          userId: session.user.id,
        },
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      return res.status(403).json({
        error: "You are not a member of this workspace",
      });
    }

    const userName =
      session.user.name?.trim() || session.user.email;

    const user = {
      id: session.user.id,
      name: userName,
      color: getCollaborationColor(session.user.id),
    };

    const token = await createCollaborationToken({
      userId: user.id,
      documentId: document.id,
      name: user.name,
      color: user.color,
    });

    return res.json({
      token,
      expiresIn: 300,
      canEdit: canEditDocument(membership.role as WorkspaceRole),
      user,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "UNAUTHORIZED"
    ) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    console.error("Create collaboration token failed:", error);

    return res.status(500).json({
      error: "Failed to authorize collaboration",
    });
  }
});

export default router;
