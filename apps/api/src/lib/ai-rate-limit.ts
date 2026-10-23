import { prisma } from "@workspace/db";

export const AI_REQUEST_WINDOW_SECONDS = 60;
export const AI_REQUEST_LIMIT_PER_WINDOW = 10;

const CLEANUP_RETENTION_SECONDS = 10 * 60;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 5_000;

let lastCleanupAttemptAt = 0;

export function isAiRequestLimitReached(requestCount: number): boolean {
  return requestCount >= AI_REQUEST_LIMIT_PER_WINDOW;
}

async function cleanupExpiredRequests(): Promise<void> {
  const now = Date.now();

  if (now - lastCleanupAttemptAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  // Set this before the query so concurrent requests do not all
  // start the same cleanup operation.
  lastCleanupAttemptAt = now;

  try {
    await prisma.$executeRaw`
      WITH expired AS (
        SELECT "id"
        FROM "ai_request_events"
        WHERE "requested_at" <
          clock_timestamp() -
          (${CLEANUP_RETENTION_SECONDS} * INTERVAL '1 second')
        ORDER BY "requested_at" ASC
        LIMIT ${CLEANUP_BATCH_SIZE}
      )
      DELETE FROM "ai_request_events" AS events
      USING expired
      WHERE events."id" = expired."id"
    `;
  } catch (error) {
    // Cleanup is best-effort. A cleanup failure must not silently
    // change the rate-limit decision or reject an otherwise valid request.
    console.warn("Failed to clean up expired AI request events.", error);
  }
}

export async function allowAiRequest(userId: string): Promise<boolean> {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new TypeError("A user ID is required to check the AI rate limit.");
  }

  await cleanupExpiredRequests();

  const rows = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT public.allow_ai_request(
      ${normalizedUserId},
      ${AI_REQUEST_WINDOW_SECONDS},
      ${AI_REQUEST_LIMIT_PER_WINDOW}
    ) AS "allowed"
  `;

  return rows[0]?.allowed === true;
}