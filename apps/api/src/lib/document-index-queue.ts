import { createHash } from "node:crypto";

import { prisma } from "@workspace/db";
import { extractDocumentText } from "./ai-document-assistant";

type IndexableDocument = {
  id: string;
  title: string;
  workspaceId: string;
  content: unknown;
};

export function getDocumentIndexHash(
  document: Pick<IndexableDocument, "title" | "content">,
): string {
  const text = extractDocumentText(document.content);

  return createHash("sha256")
    .update(`${document.title.trim()}\n${text}`)
    .digest("hex");
}

export async function enqueueDocumentIndexing(
  document: IndexableDocument,
): Promise<void> {
  // Don't create jobs during integration tests. The worker is disabled
  // in test mode, and tests should not queue external AI operations.
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const requestedHash = getDocumentIndexHash(document);

  const existing = await prisma.documentIndexJob.findUnique({
    where: { documentId: document.id },
    select: {
      id: true,
      status: true,
      requestedHash: true,
      indexedHash: true,
    },
  });

  // The currently indexed text has not changed.
  if (
    existing?.status === "SUCCEEDED" &&
    existing.indexedHash === requestedHash
  ) {
    return;
  }

  // A matching job is already pending or being processed.
  if (
    existing?.requestedHash === requestedHash &&
    (existing.status === "PENDING" ||
      existing.status === "PROCESSING")
  ) {
    return;
  }

  await prisma.documentIndexJob.upsert({
    where: { documentId: document.id },
    create: {
      documentId: document.id,
      workspaceId: document.workspaceId,
      status: "PENDING",
      requestedHash,
    },
    update: {
      workspaceId: document.workspaceId,
      status: "PENDING",
      requestedHash,
      requestedAt: new Date(),
      attemptCount: 0,
      lastError: null,
      startedAt: null,
      completedAt: null,
    },
  });
}