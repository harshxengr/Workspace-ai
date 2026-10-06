import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "@workspace/auth";
import { prisma } from "@workspace/db";
import { requireAuth } from "@workspace/auth";
import workspaceRouter from "./routes/workspaces";
import memberRouter from "./routes/members";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  }),
);

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

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});