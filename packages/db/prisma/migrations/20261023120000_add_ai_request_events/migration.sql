CREATE TABLE "ai_request_events" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_events_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
);

CREATE INDEX "ai_request_events_user_id_requested_at_idx"
ON "ai_request_events" ("user_id", "requested_at");

CREATE INDEX "ai_request_events_requested_at_idx"
ON "ai_request_events" ("requested_at");