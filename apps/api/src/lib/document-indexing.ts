import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@workspace/db";

import { extractDocumentText } from "./ai-document-assistant";
import {
  chunkDocumentText,
  MAX_DOCUMENT_TEXT_CHARACTERS,
} from "./document-chunking";
import {
  EMBEDDING_DIMENSIONS,
  generateEmbeddings,
} from "./gemini-embeddings";
import { getDocumentIndexHash } from "./document-index-queue";


type StoredDocument = {
  id: string;
  title: string;
  workspaceId: string;
  content: unknown;
};

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPgVector(values: number[]): string {
  if (
    values.length !== EMBEDDING_DIMENSIONS ||
    !values.every(Number.isFinite)
  ) {
    throw new Error("INVALID_EMBEDDING_VECTOR");
  }

  return `[${values.join(",")}]`;
}

export async function indexStoredDocument(
  document: StoredDocument,
): Promise<{
  documentId: string;
  charactersIndexed: number;
  chunksIndexed: number;
}> {
  const text = extractDocumentText(document.content);

  if (text.length > MAX_DOCUMENT_TEXT_CHARACTERS) {
    throw new Error("DOCUMENT_TEXT_TOO_LARGE");
  }

  const chunks = chunkDocumentText(text);

  // Generate embeddings before replacing existing chunks.
  // If the provider fails, the existing index remains available.
  const embeddings = chunks.length
    ? await generateEmbeddings(
      chunks,
      "RETRIEVAL_DOCUMENT",
      document.title,
    )
    : [];

  if (embeddings.length !== chunks.length) {
    throw new Error("EMBEDDING_COUNT_MISMATCH");
  }

  const indexedChunks = chunks.map((content, chunkIndex) => ({
    id: randomUUID(),
    chunkIndex,
    content,
    contentHash: hashContent(`${document.title}\n${content}`),
    embedding: toPgVector(embeddings[chunkIndex]!),
  }));

  await prisma.$transaction(async (tx) => {
    // Lock the row and reject indexing if the document was changed
    // while embeddings were being generated.

    const currentDocuments = await tx.$queryRaw<
      Array<{
        workspaceId: string;
        title: string;
        content: unknown;
      }>
    >`
  SELECT
    "workspaceId",
    "title",
    "content"
  FROM "documents"
  WHERE "id" = ${document.id}
  FOR UPDATE
`;

    const currentDocument = currentDocuments[0];

    if (!currentDocument) {
      throw new Error("DOCUMENT_DELETED_DURING_INDEXING");
    }

    if (currentDocument.workspaceId !== document.workspaceId) {
      throw new Error("DOCUMENT_WORKSPACE_CHANGED");
    }

    // Ignore timestamp-only changes from collaborative persistence.
    // Only reject the indexing result when the actual title or content
    // differs from the version for which embeddings were generated.
    if (
      getDocumentIndexHash(currentDocument) !==
      getDocumentIndexHash(document)
    ) {
      throw new Error("DOCUMENT_CHANGED_DURING_INDEXING");
    }

    await tx.$executeRaw`
      DELETE FROM "document_chunks"
      WHERE "document_id" = ${document.id}
    `;

    for (const chunk of indexedChunks) {
      await tx.$executeRaw`
        INSERT INTO "document_chunks" (
          "id",
          "document_id",
          "workspace_id",
          "chunk_index",
          "content",
          "content_hash",
          "embedding",
          "created_at"
        )
        VALUES (
          ${chunk.id},
          ${document.id},
          ${document.workspaceId},
          ${chunk.chunkIndex},
          ${chunk.content},
          ${chunk.contentHash},
          ${chunk.embedding}::vector,
          CURRENT_TIMESTAMP
        )
      `;
    }
  });

  return {
    documentId: document.id,
    charactersIndexed: text.length,
    chunksIndexed: indexedChunks.length,
  };
}