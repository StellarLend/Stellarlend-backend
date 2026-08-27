-- Add monotonic revisions so a cached portfolio can never combine rows from
-- incompatible account states.
ALTER TABLE "accounts" ADD COLUMN "portfolioVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "positions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Rollback: restore a backup before dropping these revisions. Removing them
-- is destructive to optimistic-concurrency and cache-consistency evidence.
