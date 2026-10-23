import { expect, test } from "bun:test";

import { diversifyByDocument } from "./knowledge-retrieval";

test("diversifies ranked chunks while preserving their order", () => {
  const rows = [
    { documentId: "a", chunkIndex: 0 },
    { documentId: "a", chunkIndex: 1 },
    { documentId: "a", chunkIndex: 2 },
    { documentId: "b", chunkIndex: 0 },
    { documentId: "c", chunkIndex: 0 },
    { documentId: "b", chunkIndex: 1 },
  ];

  expect(diversifyByDocument(rows)).toEqual([
    { documentId: "a", chunkIndex: 0 },
    { documentId: "a", chunkIndex: 1 },
    { documentId: "b", chunkIndex: 0 },
    { documentId: "c", chunkIndex: 0 },
    { documentId: "b", chunkIndex: 1 },
  ]);
});

test("supports a single chunk per document", () => {
  const rows = [
    { documentId: "a", chunkIndex: 0 },
    { documentId: "a", chunkIndex: 1 },
    { documentId: "b", chunkIndex: 0 },
  ];

  expect(diversifyByDocument(rows, 1)).toEqual([
    { documentId: "a", chunkIndex: 0 },
    { documentId: "b", chunkIndex: 0 },
  ]);
});

test("returns an empty list for empty input", () => {
  expect(diversifyByDocument([])).toEqual([]);
});

test("rejects an invalid per-document limit", () => {
  expect(() => diversifyByDocument([], 0)).toThrow(RangeError);
  expect(() => diversifyByDocument([], 1.5)).toThrow(RangeError);
});
