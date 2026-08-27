CREATE TYPE "RetryJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD_LETTER');

CREATE TABLE "retry_jobs" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(100) NOT NULL,
    "dedupeKey" VARCHAR(255),
    "payload" JSONB NOT NULL,
    "status" "RetryJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retry_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retry_jobs_dedupeKey_key" ON "retry_jobs"("dedupeKey");
CREATE INDEX "retry_jobs_status_nextAttemptAt_idx" ON "retry_jobs"("status", "nextAttemptAt");
