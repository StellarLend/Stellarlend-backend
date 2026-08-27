import type { PrismaClient, RetryJobStatus } from "@prisma/client";

export interface RetryJob<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export interface RetryJobStore {
  enqueue(input: { kind: string; payload: unknown; maxAttempts: number; dedupeKey?: string }): Promise<RetryJob>;
  claim(now: Date): Promise<RetryJob | null>;
  succeed(id: string): Promise<void>;
  retry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
  deadLetter(id: string, error: string): Promise<void>;
  replay(id: string): Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

/** Bounded exponential delay; no caller can create an unbounded retry storm. */
export function retryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 10));
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** exponent);
  return Math.floor(base * (0.8 + random() * 0.4));
}

export class PermanentJobError extends Error {
  readonly retryable = false;
}

export class DurableRetryQueue {
  constructor(private readonly store: RetryJobStore, private readonly now = () => new Date()) {}

  enqueue(kind: string, payload: unknown, options: { maxAttempts?: number; dedupeKey?: string } = {}): Promise<RetryJob> {
    const maxAttempts = Math.max(1, Math.min(20, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)));
    return this.store.enqueue({ kind, payload, maxAttempts, dedupeKey: options.dedupeKey });
  }

  async processOnce<T>(handler: (job: RetryJob<T>) => Promise<void>): Promise<"idle" | "succeeded" | "retrying" | "dead_letter"> {
    const job = await this.store.claim(this.now());
    if (!job) return "idle";

    try {
      await handler(job as RetryJob<T>);
      await this.store.succeed(job.id);
      return "succeeded";
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "job failed";
      const retryable = !(error instanceof PermanentJobError) && (error as { retryable?: unknown })?.retryable !== false;
      if (!retryable || job.attempts >= job.maxAttempts) {
        await this.store.deadLetter(job.id, message);
        return "dead_letter";
      }
      await this.store.retry(job.id, new Date(this.now().getTime() + retryDelayMs(job.attempts)), message);
      return "retrying";
    }
  }

  replay(id: string): Promise<void> {
    return this.store.replay(id);
  }
}

/** Postgres-backed store: claims use SKIP LOCKED, so workers do not duplicate work. */
export function createPrismaRetryJobStore(prisma: Pick<PrismaClient, "$transaction">): RetryJobStore {
  const run = <T>(fn: (tx: { $queryRawUnsafe<R>(query: string, ...values: unknown[]): Promise<R[]>; $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> }) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => fn(tx as never));

  return {
    async enqueue(input) {
      const rows = await run((tx) => tx.$queryRawUnsafe<RetryJob[]>(
        `INSERT INTO retry_jobs (id, kind, "dedupeKey", payload, "maxAttempts", "nextAttemptAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("dedupeKey") DO UPDATE SET "dedupeKey" = EXCLUDED."dedupeKey"
         RETURNING id, kind, payload, attempts, "maxAttempts"`,
        input.kind, input.dedupeKey ?? null, JSON.stringify(input.payload), input.maxAttempts,
      ));
      return rows[0] as RetryJob;
    },
    async claim(now) {
      const rows = await run((tx) => tx.$queryRawUnsafe<RetryJob[]>(
        `UPDATE retry_jobs SET status = 'RUNNING', attempts = attempts + 1, "lockedAt" = $1, "updatedAt" = $1
         WHERE id = (SELECT id FROM retry_jobs WHERE status = 'QUEUED' AND "nextAttemptAt" <= $1 ORDER BY "nextAttemptAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING id, kind, payload, attempts, "maxAttempts"`, now,
      ));
      return rows[0] ?? null;
    },
    async succeed(id) { await run((tx) => tx.$executeRawUnsafe(`UPDATE retry_jobs SET status = 'SUCCEEDED', "lockedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`, id)); },
    async retry(id, nextAttemptAt, error) { await run((tx) => tx.$executeRawUnsafe(`UPDATE retry_jobs SET status = 'QUEUED', "nextAttemptAt" = $2, "lastError" = $3, "lockedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`, id, nextAttemptAt, error)); },
    async deadLetter(id, error) { await run((tx) => tx.$executeRawUnsafe(`UPDATE retry_jobs SET status = 'DEAD_LETTER', "lastError" = $2, "lockedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`, id, error)); },
    async replay(id) { await run((tx) => tx.$executeRawUnsafe(`UPDATE retry_jobs SET status = 'QUEUED', "nextAttemptAt" = CURRENT_TIMESTAMP, "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'DEAD_LETTER'`, id)); },
  };
}

export type PersistedRetryJobStatus = RetryJobStatus;
