-- Durable idempotency and reconciliation state for transaction-producing API calls.
CREATE TABLE "transaction_operations" (
    "id" TEXT NOT NULL,
    "operationId" VARCHAR(128) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "account" VARCHAR(56) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "signedTransaction" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "submissionLeaseToken" VARCHAR(64),
    "submissionLeaseUntil" TIMESTAMP(3),
    "ledgerTransaction" VARCHAR(128),
    "failureCode" VARCHAR(64),
    "failureMessage" VARCHAR(500),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transaction_operations_operationId_key"
    ON "transaction_operations"("operationId");
CREATE INDEX "transaction_operations_status_idx"
    ON "transaction_operations"("status");
