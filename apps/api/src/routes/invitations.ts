import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";

import { getWebOrigins, requireAuth } from "@workspace/auth";
import { prisma } from "@workspace/db";

import {
  canAddWorkspaceMembers,
  canAssignWorkspaceRole,
} from "../lib/member-permissions";
import type { WorkspaceRole } from "../lib/document-permissions";
import { sendWorkspaceInvitationEmail } from "../lib/invitation-email";

const router: Router = Router();

const invitationSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]).default("MEMBER"),
});

const INVITATION_LIFETIME_DAYS = 7;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createToken(): string {
  return randomBytes(32).toString("base64url");
}

function getPublicAppOrigin(): string {
  const configuredOrigin = process.env.APP_BASE_URL?.trim();
  const allowedOrigins = getWebOrigins();
  const candidate = configuredOrigin || allowedOrigins[0];

  if (!candidate) {
    throw new Error("APP_BASE_URL is not configured.");
  }

  const parsed = new URL(candidate);

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("APP_BASE_URL must contain a public origin only.");
  }

  if (!allowedOrigins.includes(parsed.origin)) {
    throw new Error("APP_BASE_URL must match an origin in WEB_ORIGINS.");
  }

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }

  return parsed.origin;
}

function isUnavailable(invitation: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): boolean {
  return (
    invitation.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.expiresAt.getTime() <= Date.now()
  );
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function getWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const membership = await prisma.workspaceMember.findUnique({
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

  return (membership?.role as WorkspaceRole | undefined) ?? null;
}

async function requireInvitationManager(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const role = await getWorkspaceRole(workspaceId, userId);

  return role !== null && canAddWorkspaceMembers(role);
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message === "UNAUTHORIZED";
}

/**
 * Create an invitation.
 *
 * POST /api/workspaces/:workspaceId/invitations
 */
router.post("/workspaces/:workspaceId/invitations", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId } = req.params;

    const parsed = invitationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid invitation data",
        details: parsed.error.flatten(),
      });
    }

    const actorRole = await getWorkspaceRole(workspaceId, session.user.id);

    if (actorRole === null || !canAddWorkspaceMembers(actorRole)) {
      return res.status(403).json({
        error: "Only workspace owners and admins can invite members",
      });
    }

    if (!canAssignWorkspaceRole(actorRole, parsed.data.role)) {
      return res.status(403).json({
        error: "You cannot invite a member with this role",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!workspace) {
      return res.status(404).json({
        error: "Workspace not found",
      });
    }

    const { email, role } = parsed.data;

    // If this email already belongs to a member, an invitation is not needed.
    const existingUser = await prisma.user.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (existingUser) {
      const existingMembership = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: existingUser.id,
          },
        },
      });

      if (existingMembership) {
        return res.status(409).json({
          error: "User is already a workspace member",
        });
      }
    }

    const now = new Date();

    const pendingInvitation = await prisma.workspaceInvitation.findFirst({
      where: {
        workspaceId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });

    if (pendingInvitation) {
      return res.status(409).json({
        error:
          "An active invitation already exists for this email. Revoke it before sending another.",
      });
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const emailFrom = process.env.EMAIL_FROM?.trim();

    // Integration tests and local development without email configuration
    // receive a preview link. Production never returns a secret invite link
    // in an API response as a substitute for email delivery.
    const previewMode =
      process.env.NODE_ENV === "test" ||
      (process.env.NODE_ENV !== "production" && !apiKey && !emailFrom);

    if (!previewMode && (!apiKey || !emailFrom)) {
      return res.status(503).json({
        error:
          "Email invitations are not configured. Set RESEND_API_KEY and EMAIL_FROM.",
      });
    }

    const appOrigin = getPublicAppOrigin();
    const token = createToken();
    const expiresAt = new Date(
      now.getTime() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation = await prisma.workspaceInvitation.create({
      data: {
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt,
        workspaceId,
        invitedByUserId: session.user.id,
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const invitationUrl = `${appOrigin}/invite/${token}`;

    if (previewMode) {
      return res.status(201).json({
        invitation,
        delivery: "preview",
        inviteUrl: invitationUrl,
      });
    }

    try {
      await sendWorkspaceInvitationEmail({
        to: email,
        from: emailFrom!,
        workspaceName: workspace.name,
        inviterName: session.user.name?.trim() || session.user.email,
        role,
        invitationUrl,
        expiresAt,
      });
    } catch (error) {
      await prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });

      console.error("Workspace invitation email delivery failed:", error);

      return res.status(502).json({
        error:
          "The invitation email could not be sent. Check the email provider configuration and try again.",
      });
    }

    return res.status(201).json({
      invitation,
      delivery: "email",
    });
  } catch (error) {
    console.error("Create workspace invitation failed:", error);

    if (isUnauthorized(error)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.status(500).json({
      error: "Failed to create workspace invitation",
    });
  }
});

/**
 * List active invitations for a workspace.
 *
 * GET /api/workspaces/:workspaceId/invitations
 */
router.get("/workspaces/:workspaceId/invitations", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const { workspaceId } = req.params;

    if (!(await requireInvitationManager(workspaceId, session.user.id))) {
      return res.status(403).json({
        error: "Only workspace owners and admins can view invitations",
      });
    }

    const invitations = await prisma.workspaceInvitation.findMany({
      where: {
        workspaceId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({ invitations });
  } catch (error) {
    if (isUnauthorized(error)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.error("List workspace invitations failed:", error);

    return res.status(500).json({
      error: "Failed to list workspace invitations",
    });
  }
});

/**
 * Revoke a pending invitation.
 *
 * DELETE /api/workspaces/:workspaceId/invitations/:invitationId
 */
router.delete(
  "/workspaces/:workspaceId/invitations/:invitationId",
  async (req, res) => {
    try {
      const session = await requireAuth(req.headers);
      const { workspaceId, invitationId } = req.params;

      if (!(await requireInvitationManager(workspaceId, session.user.id))) {
        return res.status(403).json({
          error: "Only workspace owners and admins can revoke invitations",
        });
      }

      const invitation = await prisma.workspaceInvitation.findFirst({
        where: {
          id: invitationId,
          workspaceId,
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (!invitation) {
        return res.status(404).json({
          error: "Pending invitation not found",
        });
      }

      await prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });

      return res.status(204).send();
    } catch (error) {
      if (isUnauthorized(error)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.error("Revoke workspace invitation failed:", error);

      return res.status(500).json({
        error: "Failed to revoke workspace invitation",
      });
    }
  },
);

/**
 * Retrieve public details for a valid invitation link.
 *
 * GET /api/invitations/:token
 */
router.get("/invitations/:token", async (req, res) => {
  try {
    const token = req.params.token;

    if (!token || token.length < 32 || token.length > 128) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        workspace: {
          select: {
            name: true,
            slug: true,
          },
        },
        invitedBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invitation || isUnavailable(invitation)) {
      return res
        .status(404)
        .json({ error: "Invitation is invalid or expired" });
    }

    return res.json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        workspace: invitation.workspace,
        inviterName:
          invitation.invitedBy.name?.trim() || invitation.invitedBy.email,
      },
    });
  } catch (error) {
    console.error("Get invitation details failed:", error);

    return res.status(500).json({
      error: "Failed to load invitation",
    });
  }
});

/**
 * Accept an invitation using the logged-in account.
 *
 * POST /api/invitations/:token/accept
 */
router.post("/invitations/:token/accept", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);
    const token = req.params.token;

    if (!token || token.length < 32 || token.length > 128) {
      return res.status(404).json({ error: "Invitation not found" });
    }

    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        workspaceId: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation || isUnavailable(invitation)) {
      return res.status(404).json({
        error: "Invitation is invalid, expired, or already used",
      });
    }

    if (
      normalizeEmail(session.user.email) !== normalizeEmail(invitation.email)
    ) {
      return res.status(403).json({
        error: "Sign in using the email address this invitation was sent to",
      });
    }

    const existingMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId: session.user.id,
        },
      },
    });

    if (existingMembership) {
      return res.status(409).json({
        error: "You are already a member of this workspace",
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.workspaceInvitation.updateMany({
          where: {
            id: invitation.id,
            tokenHash: hashToken(token),
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            acceptedAt: new Date(),
          },
        });

        if (claim.count !== 1) {
          throw new Error("INVITATION_NO_LONGER_VALID");
        }

        await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: session.user.id,
            role: invitation.role,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "INVITATION_NO_LONGER_VALID"
      ) {
        return res.status(404).json({
          error: "Invitation is invalid, expired, or already used",
        });
      }

      if (isUniqueConflict(error)) {
        return res.status(409).json({
          error: "You are already a member of this workspace",
        });
      }

      throw error;
    }

    return res.json({
      workspace: invitation.workspace,
      role: invitation.role,
    });
  } catch (error) {
    if (isUnauthorized(error)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.error("Accept workspace invitation failed:", error);

    return res.status(500).json({
      error: "Failed to accept workspace invitation",
    });
  }
});

export default router;
