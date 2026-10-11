
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

describe("Yjs document synchronization", () => {
    test("concurrent updates converge to the same content", () => {
        const firstClient = new Y.Doc();
        const secondClient = new Y.Doc();

        try {
            const firstText = firstClient.getText("content");
            const secondText = secondClient.getText("content");

            // Simulate independent edits before the clients sync.
            firstText.insert(0, "from first client");
            secondText.insert(0, "from second client");

            const firstUpdate = Y.encodeStateAsUpdate(firstClient);
            const secondUpdate = Y.encodeStateAsUpdate(secondClient);

            // Deliver each client's changes to the other.
            Y.applyUpdate(firstClient, secondUpdate);
            Y.applyUpdate(secondClient, firstUpdate);

            expect(firstText.toString()).toBe(secondText.toString());
            expect(firstText.toString()).toContain("from first client");
            expect(firstText.toString()).toContain("from second client");
        } finally {
            firstClient.destroy();
            secondClient.destroy();
        }
    });

    test("serialized Yjs state can be restored in a new document", () => {
        const original = new Y.Doc();

        try {
            const originalText = original.getText("content");
            originalText.insert(0, "Persisted WorkspaceAI content");

            const savedState = Y.encodeStateAsUpdate(original);

            const restored = new Y.Doc();

            try {
                Y.applyUpdate(restored, savedState);

                expect(restored.getText("content").toString()).toBe(
                    "Persisted WorkspaceAI content",
                );
            } finally {
                restored.destroy();
            }
        } finally {
            original.destroy();
        }
    });
});
