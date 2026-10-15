import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "@workspace/auth";
import { prisma } from "@workspace/db";

import {
  AI_SYSTEM_INSTRUCTION,
  buildAiPrompt,
  extractDocumentText,
} from "../lib/ai-document-assistant";

import { allowAiRequest } from "../lib/ai-rate-limit";

const router: Router = Router();

const aiRequestSchema = z.object({
  action: z.enum(["summarize", "improve", "continue", "ask"]),
  content: z.unknown(),
  selectedText: z.string().max(10_000).optional(),
  question: z.string().trim().min(1).max(1_200).optional(),
});

const MAX_DOCUMENT_CHARACTERS = 24_000;
const REQUEST_TIMEOUT_MS = 30_000;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

router.post("/documents/:documentId/ai", async (req, res) => {
  try {
    const session = await requireAuth(req.headers);

    const parsed = aiRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid AI request",
        details: parsed.error.flatten(),
      });
    }

    const { action, content } = parsed.data;

    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content)
    ) {
      return res.status(400).json({
        error: "Valid document content is required",
      });
    }

    const root = content as Record<string, unknown>;

    if (root.type !== "doc" || !Array.isArray(root.content)) {
      return res.status(400).json({
        error: "A valid Tiptap document is required",
      });
    }

    // Resolve the document and verify membership before sending any
    // document content to the external AI provider.
    const document = await prisma.document.findUnique({
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

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: document.workspaceId,
          userId: session.user.id,
        },
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    const documentText = extractDocumentText(content);

    if (!documentText) {
      return res.status(400).json({
        error: "Add some content before using the AI assistant",
      });
    }

    if (documentText.length > MAX_DOCUMENT_CHARACTERS) {
      return res.status(413).json({
        error: `AI supports documents up to ${MAX_DOCUMENT_CHARACTERS.toLocaleString()} characters in this version`,
      });
    }

    const selectedText = parsed.data.selectedText?.trim();

    if (action === "improve" && !selectedText) {
      return res.status(400).json({
        error: "Select some text to improve",
      });
    }

    const question = parsed.data.question?.trim();

    if (action === "ask" && !question) {
      return res.status(400).json({
        error: "Enter a question about the document",
      });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return res.status(503).json({
        error: "The AI service is not configured on the API server",
      });
    }

    if (!allowAiRequest(session.user.id)) {
      res.setHeader("Retry-After", "60");

      return res.status(429).json({
        error: "AI request limit reached. Try again in a minute.",
      });
    }

    const model =
      process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

    const prompt = buildAiPrompt({
      action,
      documentText,
      selectedText,
      question,
    });

    let upstream: Response;

    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: AI_SYSTEM_INSTRUCTION }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1_024,
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "";

      if (
        errorName === "TimeoutError" ||
        errorName === "AbortError"
      ) {
        return res.status(504).json({
          error: "AI generation timed out. Please try again.",
        });
      }

      console.error("Gemini API request failed:", errorName || "unknown");

      return res.status(502).json({
        error: "Could not reach the AI provider. Please try again.",
      });
    }

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return res.status(429).json({
          error: "The AI provider is busy. Please try again shortly.",
        });
      }

      // Do not return the provider's raw response to the browser.
      console.error("Gemini API returned status:", upstream.status);

      return res.status(502).json({
        error: "AI generation failed. Please try again.",
      });
    }

    let payload: GeminiResponse;

    try {
      payload = (await upstream.json()) as GeminiResponse;
    } catch {
      return res.status(502).json({
        error: "The AI provider returned an invalid response",
      });
    }

    const result = payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!result) {
      return res.status(502).json({
        error: "The AI provider returned an empty response",
      });
    }

    return res.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    console.error(
      "AI assistant route failed:",
      error instanceof Error ? error.name : "unknown",
    );

    return res.status(500).json({
      error: "Failed to process AI request",
    });
  }
});

export default router;