"use client";

import { useState } from "react";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";

import { apiFetch } from "../lib/api";

type AiAction = "summarize" | "improve" | "continue" | "ask";

type AiAssistantPanelProps = {
  documentId: string;
  editor: TiptapEditor;
  canApply: boolean;
};

const ACTIONS: Array<{ action: AiAction; label: string }> = [
  { action: "summarize", label: "Summarize" },
  { action: "improve", label: "Improve selection" },
  { action: "continue", label: "Continue writing" },
  { action: "ask", label: "Ask" },
];

export default function AiAssistantPanel({
  documentId,
  editor,
  canApply,
}: AiAssistantPanelProps) {
  const [question, setQuestion] = useState("");
  const [busyAction, setBusyAction] = useState<AiAction | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function runAction(action: AiAction) {
    const { from, to } = editor.state.selection;

    const selectedText =
      from < to
        ? editor.state.doc.textBetween(from, to, "\n")
        : "";

    if (action === "improve" && !selectedText.trim()) {
      setError("Select text in the document before choosing Improve selection.");
      return;
    }

    if (action === "ask" && !question.trim()) {
      setError("Enter a question about this document.");
      return;
    }

    setBusyAction(action);
    setError("");
    setNotice("");
    setResult("");

    try {
      const response = await apiFetch<{ result: string }>(
        `/api/documents/${documentId}/ai`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            content: editor.getJSON(),
            selectedText: selectedText || undefined,
            question: question.trim() || undefined,
          }),
        },
      );

      setResult(response.result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "AI generation failed. Please try again.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function insertSuggestion() {
    if (!canApply || !result.trim()) {
      return;
    }

    // Insert plain text as Tiptap JSON nodes instead of interpreting
    // generated output as HTML.
    const paragraphs: JSONContent[] = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      }));

    if (paragraphs.length === 0) {
      return;
    }

    editor.chain().focus().insertContent(paragraphs).run();

    setResult("");
    setNotice("Suggestion inserted into the collaborative document.");
    setError("");
  }

  async function copySuggestion() {
    try {
      await navigator.clipboard.writeText(result);
      setNotice("Suggestion copied to the clipboard.");
      setError("");
    } catch {
      setError("Could not copy the suggestion. Please select and copy it manually.");
    }
  }

  return (
    <section
      id="ai-assistant-panel"
      aria-labelledby="ai-assistant-heading"
      className="rounded-lg border p-4"
    >
      <div className="mb-3">
        <h3 id="ai-assistant-heading" className="font-semibold">
          AI document assistant
        </h3>

        <p className="mt-1 text-sm text-muted-foreground">
          Generate a suggestion, review it, and choose whether to insert it.
          Document text is sent to the configured Gemini service.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(({ action, label }) => (
          <button
            key={action}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void runAction(action)}
            disabled={busyAction !== null}
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            {busyAction === action ? "Generating..." : label}
          </button>
        ))}
      </div>

      <label
        htmlFor="ai-document-question"
        className="mt-4 block text-sm font-medium"
      >
        Ask about this document
      </label>

      <textarea
        id="ai-document-question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        disabled={busyAction !== null}
        maxLength={1_200}
        rows={2}
        placeholder="What are the main decisions or open questions?"
        className="mt-2 w-full rounded-md border bg-transparent p-3 text-sm"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}

      {result && (
        <div className="mt-4 border-t pt-4">
          <h4 className="font-medium">Suggestion</h4>

          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md border p-3 font-sans text-sm">
            {result}
          </pre>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={insertSuggestion}
              disabled={!canApply}
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            >
              Insert into document
            </button>

            <button
              type="button"
              onClick={() => void copySuggestion()}
              className="rounded-md border px-3 py-2 text-sm"
            >
              Copy suggestion
            </button>
          </div>

          {!canApply && (
            <p className="mt-2 text-sm text-muted-foreground">
              Your current access is read-only, so you can copy the
              suggestion but cannot insert it into the document.
            </p>
          )}
        </div>
      )}
    </section>
  );
}