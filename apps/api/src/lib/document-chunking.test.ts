import { describe, expect, test } from "bun:test";

import {
  chunkDocumentText,
  DOCUMENT_CHUNK_SIZE,
  MAX_DOCUMENT_TEXT_CHARACTERS,
} from "./document-chunking";

describe("document chunking", () => {
  test("returns no chunks for empty text", () => {
    expect(chunkDocumentText("   \n\n  ")).toEqual([]);
  });

  test("keeps short documents in a single chunk", () => {
    const chunks = chunkDocumentText(
      "WorkspaceAI supports real-time collaboration.",
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(
      "WorkspaceAI supports real-time collaboration.",
    );
  });

  test("splits long documents into bounded chunks", () => {
    const text = Array.from(
      { length: 1_000 },
      (_, index) => `Document sentence number ${index}.`,
    ).join(" ");

    expect(text.length).toBeGreaterThan(MAX_DOCUMENT_TEXT_CHARACTERS);

    // The chunker handles long input; the indexing service is
    // responsible for enforcing the overall document-size limit.
    const chunks = chunkDocumentText(text);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DOCUMENT_CHUNK_SIZE);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});