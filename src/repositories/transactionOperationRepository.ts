import { PrismaClient } from "@prisma/client";

import type {
  CreateOperationInput,
  OperationPatch,
  OperationStatus,
  TransactionOperation,
} from "../services/transaction/types.js";

export interface TransactionOperationRepository {
  find(operationId: string): Promise<TransactionOperation | null>;
  create(input: CreateOperationInput): Promise<TransactionOperation>;
  claim(operationId: string, token: string, leaseUntil: Date): Promise<TransactionOperation | null>;
  update(operationId: string, patch: OperationPatch): Promise<TransactionOperation>;
  recoverable(): Promise<TransactionOperation[]>;
}

function fromRow(row: {
  operationId: string;
  action: string;
  account: string;
  payloadHash: string;
  signedTransaction: string;
  status: string;
  attemptCount: number;
  submissionLeaseToken: string | null;
  submissionLeaseUntil: Date | null;
  ledgerTransaction: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TransactionOperation {
  return {
    ...row,
    action: row.action as TransactionOperation["action"],
    status: row.status as OperationStatus,
  };
}

export class PrismaTransactionOperationRepository implements TransactionOperationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(operationId: string): Promise<TransactionOperation | null> {
    const row = await this.prisma.transactionOperation.findUnique({
      where: { operationId },
    });
    return row ? fromRow(row) : null;
  }

  async create(input: CreateOperationInput): Promise<TransactionOperation> {
    const row = await this.prisma.transactionOperation.create({
      data: {
        ...input,
        status: "pending",
      },
    });
    return fromRow(row);
  }

  async claim(
    operationId: string,
    token: string,
    leaseUntil: Date,
  ): Promise<TransactionOperation | null> {
    const now = new Date();
    const claimed = await this.prisma.transactionOperation.updateMany({
      where: {
        operationId,
        status: { in: ["pending", "retryable_failed"] },
        OR: [{ submissionLeaseUntil: null }, { submissionLeaseUntil: { lt: now } }],
      },
      data: { submissionLeaseToken: token, submissionLeaseUntil: leaseUntil },
    });
    if (claimed.count === 0) return null;
    const row = await this.prisma.transactionOperation.findUniqueOrThrow({
      where: { operationId },
    });
    return fromRow(row);
  }

  async update(operationId: string, patch: OperationPatch): Promise<TransactionOperation> {
    const row = await this.prisma.transactionOperation.update({
      where: { operationId },
      data: patch,
    });
    return fromRow(row);
  }

  async recoverable(): Promise<TransactionOperation[]> {
    const rows = await this.prisma.transactionOperation.findMany({
      where: {
        status: { in: ["pending", "submitted", "retryable_failed"] },
      },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map(fromRow);
  }
}

export class InMemoryTransactionOperationRepository implements TransactionOperationRepository {
  private readonly records = new Map<string, TransactionOperation>();

  async find(operationId: string): Promise<TransactionOperation | null> {
    return this.records.get(operationId) ?? null;
  }

  async create(input: CreateOperationInput): Promise<TransactionOperation> {
    if (this.records.has(input.operationId)) {
      throw new Error(`Operation ${input.operationId} already exists.`);
    }
    const now = new Date();
    const record: TransactionOperation = {
      ...input,
      status: "pending",
      attemptCount: 0,
      submissionLeaseToken: null,
      submissionLeaseUntil: null,
      ledgerTransaction: null,
      failureCode: null,
      failureMessage: null,
      lastCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(input.operationId, record);
    return record;
  }

  async claim(
    operationId: string,
    token: string,
    leaseUntil: Date,
  ): Promise<TransactionOperation | null> {
    const existing = this.records.get(operationId);
    if (!existing) return null;
    const now = new Date();
    if (
      !["pending", "retryable_failed"].includes(existing.status) ||
      (existing.submissionLeaseUntil !== null && existing.submissionLeaseUntil > now)
    ) {
      return null;
    }
    return this.update(operationId, {
      status: existing.status,
      submissionLeaseToken: token,
      submissionLeaseUntil: leaseUntil,
    });
  }

  async update(operationId: string, patch: OperationPatch): Promise<TransactionOperation> {
    const existing = this.records.get(operationId);
    if (!existing) throw new Error(`Operation ${operationId} does not exist.`);
    const updated: TransactionOperation = {
      ...existing,
      ...patch,
      attemptCount: patch.attemptCount ?? existing.attemptCount,
      submissionLeaseToken:
        patch.submissionLeaseToken === undefined
          ? existing.submissionLeaseToken
          : patch.submissionLeaseToken,
      submissionLeaseUntil:
        patch.submissionLeaseUntil === undefined
          ? existing.submissionLeaseUntil
          : patch.submissionLeaseUntil,
      ledgerTransaction:
        patch.ledgerTransaction === undefined
          ? existing.ledgerTransaction
          : patch.ledgerTransaction,
      failureCode: patch.failureCode === undefined ? existing.failureCode : patch.failureCode,
      failureMessage:
        patch.failureMessage === undefined ? existing.failureMessage : patch.failureMessage,
      lastCheckedAt:
        patch.lastCheckedAt === undefined ? existing.lastCheckedAt : patch.lastCheckedAt,
      updatedAt: new Date(),
    };
    this.records.set(operationId, updated);
    return updated;
  }

  async recoverable(): Promise<TransactionOperation[]> {
    return [...this.records.values()]
      .filter((record) => ["pending", "submitted", "retryable_failed"].includes(record.status))
      .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime());
  }
}
