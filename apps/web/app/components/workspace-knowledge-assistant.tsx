"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { apiFetch } from "../lib/api";

type KnowledgeSource = {
  sourceNumber: number;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  documentUrl: string;
};

type KnowledgeAnswerResponse = {
  query: string;
  answer: string;
  sources: KnowledgeSource[];
};

type WorkspaceKnowledgeAssistantProps = {
  workspaceId: string;
  workspaceSlug: string;
};

export default function WorkspaceKnowledgeAssistant({
  workspaceId,
  workspaceSlug,
}: WorkspaceKnowledgeAssistantProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<KnowledgeAnswerResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Enter a question about your workspace.");
      return;
    }

    if (trimmedQuery.length > 1_200) {
      setError("Your question cannot exceed 1200 characters.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await apiFetch<KnowledgeAnswerResponse>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/knowledge/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            query: trimmedQuery,
            limit: 5,
          }),
        },
      );

      setResult(response);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not answer your question. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      aria-labelledby="workspace-knowledge-heading"
      className="mt-8 rounded-xl border p-5 md:p-6"
    >
      <div>
        <h2
          id="workspace-knowledge-heading"
          className="text-xl font-semibold"
        >
          Workspace Knowledge Assistant
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          Ask questions across your indexed workspace documents.
          Answers include links to the source passages used.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <label
          htmlFor="workspace-knowledge-query"
          className="block text-sm font-medium"
        >
          Your question
        </label>

        <textarea
          id="workspace-knowledge-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What decisions has our team made about the project?"
          maxLength={1_200}
          rows={3}
          required
          disabled={loading}
          className="w-full rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 disabled:opacity-50"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Answers are generated from indexed documents and may need
            verification against the original source.
          </p>

          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Searching documents..." : "Ask workspace"}
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-300 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {result && (
        <div className="mt-6 border-t pt-5">
          <h3 className="font-semibold">Answer</h3>

          <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">
            {result.answer}
          </div>

          <div className="mt-6">
            <h3 className="font-semibold">
              Sources ({result.sources.length})
            </h3>

            {result.sources.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No indexed source passages were found for this question.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {result.sources.map((source) => (
                  <article
                    key={`${source.documentId}-${source.chunkIndex}`}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          [{source.sourceNumber}] {source.documentTitle}
                        </p>

                        <p className="mt-1 text-xs text-muted-foreground">
                          Passage {source.chunkIndex + 1}
                        </p>
                      </div>

                      <Link
                        href={
                          `/workspaces/${encodeURIComponent(workspaceSlug)}` +
                          `/documents/${encodeURIComponent(source.documentId)}`
                        }
                        className="text-sm underline underline-offset-4"
                      >
                        Open document
                      </Link>
                    </div>

                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted-foreground">
                        View source passage
                      </summary>

                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                        {source.content}
                      </p>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}