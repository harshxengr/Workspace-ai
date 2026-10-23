
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_index_jobs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_hash" TEXT NOT NULL,
    "indexed_hash" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_index_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key"
    ON "document_chunks"("document_id", "chunk_index");

CREATE INDEX "document_chunks_workspace_id_document_id_idx"
    ON "document_chunks"("workspace_id", "document_id");

CREATE INDEX "document_chunks_embedding_hnsw_idx"
    ON "document_chunks"
    USING hnsw ("embedding" vector_cosine_ops);

CREATE UNIQUE INDEX "document_index_jobs_document_id_key"
    ON "document_index_jobs"("document_id");

CREATE INDEX "document_index_jobs_status_requested_at_idx"
    ON "document_index_jobs"("status", "requested_at");

CREATE INDEX "document_index_jobs_workspace_id_idx"
    ON "document_index_jobs"("workspace_id");

ALTER TABLE "document_chunks"
    ADD CONSTRAINT "document_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_chunks"
    ADD CONSTRAINT "document_chunks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_index_jobs"
    ADD CONSTRAINT "document_index_jobs_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_index_jobs"
    ADD CONSTRAINT "document_index_jobs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
