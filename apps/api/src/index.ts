import "dotenv/config";

import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";

import { auth, getWebOrigins, requireAuth } from "@workspace/auth";
import { prisma } from "@workspace/db";

import workspaceRouter from "./routes/workspaces";
import memberRouter from "./routes/members";
import documentRouter from "./routes/documents";
import collaborationRouter from "./routes/collaboration";
import invitationRouter from "./routes/invitations";
import aiRouter from "./routes/ai";

import { startCollaborationServer } from "./collaboration-server";

const app = express();
const PORT = process.env.PORT || 4000;
const allowedWebOrigins = new Set(getWebOrigins());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, false);
      }

      if (allowedWebOrigins.has(origin)) {
        return callback(null, origin);
      }

      return callback(null, false);
    },
    credentials: true,
  }),
);

// Reject requests carrying an explicitly untrusted Origin header.
app.use((req, res, next) => {
  const origin = req.get("origin");

  if (origin && !allowedWebOrigins.has(origin)) {
    return res.status(403).json({
      error: "Origin not allowed",
    });
  }

  return next();
});

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "workspace-ai-api",
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: "ok",
      database: "connected",
    });
  } catch {
    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);

    return res.json({
      user: session.user,
    });
  } catch {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }
});

app.use("/api/workspaces", workspaceRouter);
app.use("/api/workspaces", memberRouter);
app.use("/api", invitationRouter);
app.use("/api", documentRouter);
app.use("/api/collaboration", collaborationRouter);
app.use("/api", aiRouter);

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});

// Local development runs both servers in one process.
// Deployment can host the collaboration service separately.
if (process.env.COLLAB_SERVER_DISABLED !== "true") {
  void startCollaborationServer().catch((error: unknown) => {
    console.error("Failed to start collaboration server:", error);
  });
}
