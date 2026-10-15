import { describe, expect, test } from "bun:test";

import {
    buildAiPrompt,
    extractDocumentText,
} from "./ai-document-assistant";

describe("AI document assistant utilities", () => {
    test("extracts text from Tiptap JSON", () => {
        const content = {
            type: "doc",
            content: [
                {
                    type: "heading",
                    content: [{ type: "text", text: "Project plan" }],
                },
                {
                    type: "paragraph",
                    content: [{ type: "text", text: "Ship the first release." }],
                },
                {
                    type: "bulletList",
                    content: [
                        {
                            type: "listItem",
                            content: [
                                {
                                    type: "paragraph",
                                    content: [{ type: "text", text: "Write documentation" }],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const text = extractDocumentText(content);

        expect(text).toContain("Project plan");
        expect(text).toContain("Ship the first release.");
        expect(text).toContain("• Write documentation");
    });

    test("improves the selected text instead of the whole document", () => {
        const prompt = buildAiPrompt({
            action: "improve",
            documentText: "The entire document",
            selectedText: "This sentence needs improvement.",
        });

        expect(prompt).toContain("This sentence needs improvement.");
        expect(prompt).not.toContain("The entire document");
    });

    test("includes the question for document-grounded answers", () => {
        const prompt = buildAiPrompt({
            action: "ask",
            documentText: "The project deadline is Friday.",
            question: "When is the deadline?",
        });

        expect(prompt).toContain("When is the deadline?");
        expect(prompt).toContain("The project deadline is Friday.");
    });
});