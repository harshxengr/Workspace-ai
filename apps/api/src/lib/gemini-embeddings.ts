export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY";

type GeminiBatchResponse = {
  embeddings?: Array<{
    values?: number[];
  }>;
};

export async function generateEmbeddings(
  texts: string[],
  taskType: EmbeddingTaskType,
  title?: string,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (texts.length > 100) {
    throw new Error("TOO_MANY_EMBEDDING_REQUESTS");
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  let response: Response;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${EMBEDDING_MODEL}`,
            content: {
              parts: [{ text }],
            },

            // Explicitly request the same dimension as the database
            // index and future semantic-search queries.
            outputDimensionality: EMBEDDING_DIMENSIONS,

            embedContentConfig: {
              taskType,
              outputDimensionality: EMBEDDING_DIMENSIONS,
              ...(taskType === "RETRIEVAL_DOCUMENT" && title
                ? { title }
                : {}),
            },
          })),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("GEMINI_EMBEDDING_TIMEOUT");
    }

    console.error("Gemini embedding network request failed.");

    throw new Error("GEMINI_EMBEDDING_UNAVAILABLE");
  }

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");

    let providerStatus = "UNKNOWN";
    let providerMessage = "No error details returned";

    try {
      const payload = JSON.parse(responseText) as {
        error?: {
          status?: string;
          message?: string;
        };
      };

      providerStatus = payload.error?.status ?? providerStatus;
      providerMessage = payload.error?.message ?? providerMessage;
    } catch {
      // Do not log arbitrary upstream response bodies.
    }

    console.error("Gemini embedding request failed:", {
      httpStatus: response.status,
      providerStatus,
      providerMessage,
    });

    if (response.status === 429) {
      throw new Error("GEMINI_EMBEDDING_RATE_LIMITED");
    }

    throw new Error("GEMINI_EMBEDDING_FAILED");
  }

  let payload: GeminiBatchResponse;

  try {
    payload = (await response.json()) as GeminiBatchResponse;
  } catch {
    throw new Error("GEMINI_EMBEDDING_INVALID_RESPONSE");
  }

  const embeddings = payload.embeddings;

  if (!embeddings || embeddings.length !== texts.length) {
    console.error("Gemini returned an unexpected embedding count:", {
      expected: texts.length,
      received: embeddings?.length ?? 0,
    });

    throw new Error("GEMINI_EMBEDDING_INVALID_RESPONSE");
  }

  return embeddings.map((embedding, index) => {
    const values = embedding.values;

    if (!values || !values.every(Number.isFinite)) {
      console.error("Gemini returned an invalid embedding vector:", {
        embeddingIndex: index,
        receivedDimensions: values?.length ?? 0,
      });

      throw new Error("GEMINI_EMBEDDING_INVALID_DIMENSIONS");
    }

    if (values.length < EMBEDDING_DIMENSIONS) {
      console.error("Gemini returned fewer embedding dimensions than needed:", {
        embeddingIndex: index,
        expectedAtLeast: EMBEDDING_DIMENSIONS,
        receivedDimensions: values.length,
      });

      throw new Error("GEMINI_EMBEDDING_INVALID_DIMENSIONS");
    }

    // Google documents reduced dimensionality as truncating excess
    // values. Normalize longer responses to the configured 768 dimensions.
    return values.length === EMBEDDING_DIMENSIONS
      ? values
      : values.slice(0, EMBEDDING_DIMENSIONS);
  });
}