import { Router } from "express";
import { z } from "zod";
import { prisma } from "@workspace/db";
import { requireAuth } from "@workspace/auth";

const router = Router();

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});

router.post("/", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);

    const result = createWorkspaceSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: "Invalid workspace data",
        details: result.error.flatten(),
      });
    }

    const { name, description } = result.data;

    const slugBase = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

    const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;

    const workspace = await prisma.workspace.create({
      data: {
        name,
        description,
        slug,
        members: {
          create: {
            userId: session.user.id,
            role: "OWNER",
          },
        },
      },
      include: {
        members: true,
      },
    });

    return res.status(201).json({
      workspace,
    });
  } catch (error) {
    console.error("Create workspace failed:", error);

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    return res.status(500).json({
      error: "Failed to create workspace",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);

    const workspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: {
            userId: session.user.id,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      workspaces,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    console.error("Get workspaces failed:", error);

    return res.status(500).json({
      error: "Failed to fetch workspaces",
    });
  }
});

export default router;