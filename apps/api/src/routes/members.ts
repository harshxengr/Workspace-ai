import { Router } from "express";
import { z } from "zod";
import { prisma } from "@workspace/db";
import { requireAuth } from "@workspace/auth";

const router = Router();

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]).default("MEMBER"),
});

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

    const owner = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: session.user.id,
        role: {
          in: ["OWNER", "ADMIN"],
        },
      },
    });

    if (!owner) {
      return res.status(403).json({
        error: "Insufficient permissions",
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
      error: "Failed to fetch members",
    });
  }
});

export default router;