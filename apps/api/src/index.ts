import "dotenv/config";
import express from "express";
import { prisma } from "@workspace/db";

const app = express();
const PORT = process.env.PORT || 4000;

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
    } catch (error) {
        console.error("Database health check failed:", error);

        res.status(500).json({
            status: "error",
            database: "disconnected",
        });
    }
});

app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
});