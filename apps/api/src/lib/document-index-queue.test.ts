import { describe, expect, test } from "bun:test";

import { getDocumentIndexHash } from "./document-index-queue";

describe("document index hashing", () => {
  test("returns the same hash for identical document text", () => {
    const document = {
      title: "Project plan",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Ship the first release." },
            ],
          },
        ],
      },
    };

    expect(getDocumentIndexHash(document)).toBe(
      getDocumentIndexHash(document),
    );
  });

  test("changes the hash when the document content changes", () => {
    const first = {
      title: "Project plan",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "First release." }],
          },
        ],
      },
    };

    const second = {
      title: "Project plan",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Second release." }],
          },
        ],
      },
    };

    expect(getDocumentIndexHash(first)).not.toBe(
      getDocumentIndexHash(second),
    );
  });

  test("changes the hash when the document title changes", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Project details." }],
        },
      ],
    };

    expect(
      getDocumentIndexHash({ title: "Project A", content }),
    ).not.toBe(
      getDocumentIndexHash({ title: "Project B", content }),
    );
  });
});