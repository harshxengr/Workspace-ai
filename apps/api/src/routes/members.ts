import { Router } from "express";
import { z } from "zod";

import { prisma } from "@workspace/db";
import { requireAuth } from "@workspace/auth";

import { closeWorkspaceMemberConnections } from "../collaboration-server";
import {
  canAddWorkspaceMembers,
  canAssignWorkspaceRole,
} from "../lib/member-permissions";
import type { WorkspaceRole } from "../lib/document-permissions";

const router: Router = Router();

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]).default("MEMBER"),
});

const updateMemberSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]),
});

async function getWorkspaceMembership(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: {
      role: true,
    },
  });
}

router.post("/:workspaceId/members", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId } = req.params;

    const parsed = addMemberSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid member data",
        details: parsed.error.flatten(),
      });
    }

    const membership = await getWorkspaceMembership(
      workspaceId,
      session.user.id,
    );

    if (!membership) {
      return res.status(403).json({
        error: "Insufficient permissions",
      });
    }

    const actorRole = membership.role as WorkspaceRole;

    if (!canAddWorkspaceMembers(actorRole)) {
      return res.status(403).json({
        error: "Insufficient permissions",
      });
    }

    if (!canAssignWorkspaceRole(actorRole, parsed.data.role)) {
      return res.status(403).json({
        error: "You cannot assign this workspace role",
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email: parsed.data.email,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.id,
        },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: "User is already a workspace member",
      });
    }

    const member = await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        role: parsed.data.role,
      },
    });

    return res.status(201).json({
      member,
    });
  } catch (error) {
    console.error("Add member failed:", error);

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(500).json({
      error: "Failed to add member",
    });
  }
});

/**
 * Change a workspace member's role.
 *
 * PATCH /:workspaceId/members/:memberId
 *
 * Only workspace owners can change roles.
 * Ownership transfers are not supported by this endpoint.
 */
router.patch("/:workspaceId/members/:memberId", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId, memberId } = req.params;

    const parsed = updateMemberSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid member role",
        details: parsed.error.flatten(),
      });
    }

    const actorMembership = await getWorkspaceMembership(
      workspaceId,
      session.user.id,
    );

    if (actorMembership?.role !== "OWNER") {
      return res.status(403).json({
        error: "Only workspace owners can change member roles",
      });
    }

    const target = await prisma.workspaceMember.findFirst({
      where: {
        id: memberId,
        workspaceId,
      },
    });

    if (!target) {
      return res.status(404).json({
        error: "Workspace member not found",
      });
    }

    if (target.role === "OWNER") {
      return res.status(403).json({
        error: "Workspace ownership cannot be changed through this endpoint",
      });
    }

    if (target.role === parsed.data.role) {
      return res.json({
        member: target,
      });
    }

    const member = await prisma.workspaceMember.update({
      where: {
        id: target.id,
      },
      data: {
        role: parsed.data.role,
      },
    });

    // Force existing sessions to reconnect using the updated permissions.
    closeWorkspaceMemberConnections(workspaceId, target.userId);

    return res.json({
      member,
    });
  } catch (error) {
    console.error("Update member role failed:", error);

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(500).json({
      error: "Failed to update member role",
    });
  }
});

/**
 * Remove a member from a workspace.
 *
 * DELETE /:workspaceId/members/:memberId
 *
 * Only workspace owners can remove members.
 * A workspace owner cannot remove the owner through this endpoint.
 */
router.delete("/:workspaceId/members/:memberId", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId, memberId } = req.params;

    const actorMembership = await getWorkspaceMembership(
      workspaceId,
      session.user.id,
    );

    if (actorMembership?.role !== "OWNER") {
      return res.status(403).json({
        error: "Only workspace owners can remove members",
      });
    }

    const target = await prisma.workspaceMember.findFirst({
      where: {
        id: memberId,
        workspaceId,
      },
    });

    if (!target) {
      return res.status(404).json({
        error: "Workspace member not found",
      });
    }

    if (target.role === "OWNER") {
      return res.status(403).json({
        error: "Workspace ownership cannot be removed through this endpoint",
      });
    }

    await prisma.workspaceMember.delete({
      where: {
        id: target.id,
      },
    });

    // Close the user's active connections in this workspace immediately.
    closeWorkspaceMemberConnections(workspaceId, target.userId);

    return res.status(204).send();
  } catch (error) {
    console.error("Remove workspace member failed:", error);

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(500).json({
      error: "Failed to remove workspace member",
    });
  }
});

router.get("/:workspaceId/members", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId } = req.params;

    const isMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: session.user.id,
        },
      },
    });

    if (!isMember) {
      return res.status(403).json({
        error: "You are not a member of this workspace",
      });
    }

    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return res.json({
      members,
    });
  } catch (error) {
    console.error("Get members failed:", error);

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch workspace members",
    });
  }
});

export default router;
