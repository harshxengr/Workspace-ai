import { prisma } from "@workspace/db";

import { enqueueDocumentIndexing, getDocumentIndexHash } from "./document-index-queue";
import { indexStoredDocument } from "./document-indexing";

const POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 3;
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 1_000;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1_000;
const RECONCILIATION_BATCH_SIZE = 25;

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);

  await prisma.$executeRaw`
    UPDATE "document_index_jobs"
    SET
      "status" = CASE
        WHEN "attempt_count" >= ${MAX_ATTEMPTS} THEN 'FAILED'
        ELSE 'PENDING'
      END,
      "requested_at" = CASE
        WHEN "attempt_count" >= ${MAX_ATTEMPTS} THEN "requested_at"
        ELSE NOW()
      END,
      "last_error" = 'WORKER_RESTART_RECOVERY',
      "started_at" = NULL,
      "completed_at" = CASE
        WHEN "attempt_count" >= ${MAX_ATTEMPTS} THEN NOW()
        ELSE NULL
      END,
      "updated_at" = NOW()
    WHERE "status" = 'PROCESSING'
      AND "started_at" < ${staleBefore}
  `;
}

/**
 * Remove orphaned or clearly stale chunks in bounded batches. Keeping this
 * work inside SQL avoids loading every job/document into Node as workspaces grow.
 * Search also validates the current content hash before returning job-backed
 * chunks, so cleanup is defensive rather than the only correctness barrier.
 */
async function cleanupStaleChunks(): Promise<{
  orphanedChunksDeleted: number;
  staleChunksDeleted: number;
}> {
  const orphanedChunksDeleted = await prisma.$executeRaw`
    WITH stale AS (
      SELECT dc."id"
      FROM "document_chunks" AS dc
      WHERE NOT EXISTS (
        SELECT 1
        FROM "documents" AS d
        WHERE d."id" = dc."document_id"
          AND d."workspaceId" = dc."workspace_id"
      )
      LIMIT 500
    )
    DELETE FROM "document_chunks" AS dc
    USING stale
    WHERE dc."id" = stale."id"
  `;

  const staleChunksDeleted = await prisma.$executeRaw`
    WITH stale AS (
      SELECT dc."id"
      FROM "document_chunks" AS dc
      INNER JOIN "document_index_jobs" AS job
        ON job."document_id" = dc."document_id"
        AND job."workspace_id" = dc."workspace_id"
      WHERE job."status" <> 'PROCESSING'
        AND job."requested_hash" IS DISTINCT FROM job."indexed_hash"
      LIMIT 1000
    )
    DELETE FROM "document_chunks" AS dc
    USING stale
    WHERE dc."id" = stale."id"
  `;

  return { orphanedChunksDeleted, staleChunksDeleted };
}

/**
 * Recover missed enqueue events and successful jobs whose indexed version is
 * behind the document. Failed jobs are deliberately left alone so a broken
 * provider/configuration does not trigger an endless retry loop. The cursor
 * rotates through candidates so unchanged formatting-only edits cannot starve
 * other documents waiting for reconciliation.
 */
let reconciliationCursor: { updatedAt: Date; documentId: string } | null = null;

async function reconcileDocumentIndexes(): Promise<{
  candidatesScanned: number;
  jobsQueued: number;
  failedJobsSkipped: number;
  alreadyCurrentSkipped: number;
  errors: number;
}> {
  type CandidateRow = { documentId: string; updatedAt: Date };
  const cursorUpdatedAt = reconciliationCursor?.updatedAt ?? null;
  const cursorDocumentId = reconciliationCursor?.documentId ?? null;

  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT d."id" AS "documentId", d."updatedAt" AS "updatedAt"
    FROM "documents" AS d
    LEFT JOIN "document_index_jobs" AS job
      ON job."document_id" = d."id"
      AND job."workspace_id" = d."workspaceId"
    LEFT JOIN LATERAL (
      SELECT MAX(dc."created_at") AS "latestChunkAt"
      FROM "document_chunks" AS dc
      WHERE dc."document_id" = d."id"
        AND dc."workspace_id" = d."workspaceId"
    ) AS chunks ON TRUE
    WHERE (
      (${cursorUpdatedAt}::timestamp IS NULL)
      OR (d."updatedAt", d."id") > (
        ${cursorUpdatedAt}::timestamp,
        ${cursorDocumentId}::text
      )
    )
    AND ((
      job."id" IS NULL
      AND (
        chunks."latestChunkAt" IS NULL
        OR chunks."latestChunkAt" < d."updatedAt"
      )
    ) OR (
      job."status" = 'SUCCEEDED'
      AND (
        job."requested_hash" IS DISTINCT FROM job."indexed_hash"
        OR chunks."latestChunkAt" IS NULL
        OR chunks."latestChunkAt" < d."updatedAt"
      )
    ))
    ORDER BY d."updatedAt" ASC, d."id" ASC
    LIMIT ${RECONCILIATION_BATCH_SIZE}
  `;

  if (candidates.length === 0) {
    reconciliationCursor = null;
    return {
      candidatesScanned: 0,
      jobsQueued: 0,
      failedJobsSkipped: 0,
      alreadyCurrentSkipped: 0,
      errors: 0,
    };
  }

  reconciliationCursor =
    candidates.length === RECONCILIATION_BATCH_SIZE
      ? {
          updatedAt: candidates[candidates.length - 1]!.updatedAt,
          documentId: candidates[candidates.length - 1]!.documentId,
        }
      : null;

  const documents = await prisma.document.findMany({
    where: { id: { in: candidates.map((candidate) => candidate.documentId) } },
    select: {
      id: true,
      title: true,
      workspaceId: true,
      content: true,
    },
  });

  let jobsQueued = 0;
  let failedJobsSkipped = 0;
  let alreadyCurrentSkipped = 0;
  let errors = 0;

  for (const document of documents) {
    try {
      const currentHash = getDocumentIndexHash(document);
      const job = await prisma.documentIndexJob.findUnique({
        where: { documentId: document.id },
        select: {
          status: true,
          requestedHash: true,
          indexedHash: true,
        },
      });

      // A FAILED job requires an explicit retry from an authorized user.
      if (job?.status === "FAILED") {
        failedJobsSkipped += 1;
        continue;
      }

      // Preserve successfully indexed, current content. This also avoids
      // re-indexing legacy documents whose chunks predate the job table.
      if (
        job?.status === "SUCCEEDED" &&
        job.requestedHash === currentHash &&
        job.indexedHash === currentHash
      ) {
        alreadyCurrentSkipped += 1;
        continue;
      }

      await enqueueDocumentIndexing(document);
      jobsQueued += 1;
    } catch (error) {
      errors += 1;
      console.error("Document index reconciliation failed:", {
        documentId: document.id,
        error: safeErrorCode(error),
      });
    }
  }

  return {
    candidatesScanned: candidates.length,
    jobsQueued,
    failedJobsSkipped,
    alreadyCurrentSkipped,
    errors,
  };
}

type ClaimedJob = {
  id: string;
  documentId: string;
  workspaceId: string;
  requestedHash: string;
  requestedAt: Date;
  indexedHash: string | null;
  attemptCount: number;
};

async function claimNextJob(): Promise<ClaimedJob | null> {
  const jobs = await prisma.$queryRaw<ClaimedJob[]>`
    WITH candidate AS (
      SELECT "id"
      FROM "document_index_jobs"
      WHERE "status" = 'PENDING'
        AND "requested_at" <= NOW()
      ORDER BY "requested_at" ASC, "created_at" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "document_index_jobs" AS job
    SET
      "status" = 'PROCESSING',
      "attempt_count" = job."attempt_count" + 1,
      "started_at" = NOW(),
      "last_error" = NULL,
      "updated_at" = NOW()
    FROM candidate
    WHERE job."id" = candidate."id"
    RETURNING
      job."id" AS "id",
      job."document_id" AS "documentId",
      job."workspace_id" AS "workspaceId",
      job."requested_hash" AS "requestedHash",
      job."requested_at" AS "requestedAt",
      job."indexed_hash" AS "indexedHash",
      job."attempt_count" AS "attemptCount"
  `;

  return jobs[0] ?? null;
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";

  // Store known error codes rather than document content or arbitrary
  // provider responses that may contain sensitive information.
  if (/^[A-Z0-9_]{1,100}$/.test(message)) {
    return message;
  }

  return "DOCUMENT_INDEXING_FAILED";
}

async function processJob(job: ClaimedJob): Promise<void> {
  const processingStartedAt = Date.now();
  const queueWaitMs = Math.max(
    0,
    processingStartedAt - new Date(job.requestedAt).getTime(),
  );

  try {
    const document = await prisma.document.findUnique({
      where: { id: job.documentId },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        content: true,
      },
    });

    if (!document) {
      // Deleting the document cascades to its job. This conditional cleanup
      // is safe if deletion or a newer queue request raced with this worker.
      await prisma.documentIndexJob.deleteMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          requestedHash: job.requestedHash,
        },
      });
      return;
    }

    const currentHash = getDocumentIndexHash(document);

    if (
      document.workspaceId !== job.workspaceId ||
      currentHash !== job.requestedHash
    ) {
      // A newer document version exists. Requeue that version instead of
      // spending embeddings on stale content. The hash condition prevents
      // this worker from overwriting a newer queue request.
      await prisma.documentIndexJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          requestedHash: job.requestedHash,
        },
        data: {
          workspaceId: document.workspaceId,
          requestedHash: currentHash,
          status: "PENDING",
          requestedAt: new Date(),
          attemptCount: 0,
          lastError: null,
          startedAt: null,
          completedAt: null,
        },
      });
      return;
    }

    // An identical version already indexed does not need another embedding call.
    if (job.indexedHash === job.requestedHash) {
      const updated = await prisma.documentIndexJob.updateMany({
        where: {
          id: job.id,
          status: "PROCESSING",
          requestedHash: job.requestedHash,
        },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          lastError: null,
        },
      });

      if (updated.count > 0) {
        console.info("Document indexing skipped for an already indexed version:", {
          documentId: job.documentId,
          queueWaitMs,
          durationMs: Date.now() - processingStartedAt,
        });
      }
      return;
    }

    await indexStoredDocument(document);

    // Update only the version claimed by this worker. If the document was
    // edited while indexing, a newer request remains untouched.
    const updated = await prisma.documentIndexJob.updateMany({
      where: {
        id: job.id,
        status: "PROCESSING",
        requestedHash: job.requestedHash,
      },
      data: {
        status: "SUCCEEDED",
        indexedHash: job.requestedHash,
        completedAt: new Date(),
        lastError: null,
      },
    });

    if (updated.count > 0) {
      console.info("Document indexing completed:", {
        documentId: job.documentId,
        attempt: job.attemptCount,
        queueWaitMs,
        durationMs: Date.now() - processingStartedAt,
      });
    } else {
      console.info("Document indexing result superseded by a newer request:", {
        documentId: job.documentId,
        queueWaitMs,
        durationMs: Date.now() - processingStartedAt,
      });
    }
  } catch (error) {
    const retryable = job.attemptCount < MAX_ATTEMPTS;
    const retryDelayMs = Math.min(
      5 * 2 ** (job.attemptCount - 1),
      60,
    ) * 1_000;

    const update = await prisma.documentIndexJob.updateMany({
      where: {
        id: job.id,
        status: "PROCESSING",
        requestedHash: job.requestedHash,
      },
      data: {
        status: retryable ? "PENDING" : "FAILED",
        requestedAt: retryable
          ? new Date(Date.now() + retryDelayMs)
          : new Date(),
        lastError: safeErrorCode(error),
        startedAt: null,
        completedAt: retryable ? null : new Date(),
      },
    });

    // Do not overwrite a newer request. A zero count means that the job was
    // changed or removed while this worker was processing it.
    if (update.count > 0) {
      console.error("Document indexing attempt failed:", {
        documentId: job.documentId,
        attempt: job.attemptCount,
        willRetry: retryable,
        retryDelayMs: retryable ? retryDelayMs : 0,
        queueWaitMs,
        durationMs: Date.now() - processingStartedAt,
        error: safeErrorCode(error),
      });
    }
  }
}

async function processNextJob(): Promise<boolean> {
  const job = await claimNextJob();

  if (!job) {
    return false;
  }

  await processJob(job);
  return true;
}

export function startDocumentIndexingWorker(): () => void {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.DOCUMENT_INDEXING_WORKER_DISABLED === "true"
  ) {
    return () => undefined;
  }

  let stopped = false;
  let lastRecoveryAt = 0;
  let lastMaintenanceAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }

    let foundJob = false;

    try {
      if (Date.now() - lastRecoveryAt >= 60_000) {
        await recoverStaleJobs();
        lastRecoveryAt = Date.now();
      }

      if (Date.now() - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
        const maintenanceStartedAt = Date.now();
        const cleanup = await cleanupStaleChunks();
        const reconciliation = await reconcileDocumentIndexes();
        lastMaintenanceAt = Date.now();

        console.info("Document indexing maintenance completed:", {
          durationMs: Date.now() - maintenanceStartedAt,
          ...cleanup,
          ...reconciliation,
        });
      }

      foundJob = await processNextJob();
    } catch (error) {
      console.error(
        "Document indexing worker polling failed:",
        safeErrorCode(error),
      );
    }

    if (!stopped) {
      // Drain queued jobs promptly; otherwise poll at a short interval.
      // One tick schedules the next tick only after it has completed.
      timer = setTimeout(
        () => void tick(),
        foundJob ? 0 : POLL_INTERVAL_MS,
      );
    }
  }

  console.log("Document indexing worker started.");
  timer = setTimeout(() => void tick(), 0);

  return () => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }
  };
}
