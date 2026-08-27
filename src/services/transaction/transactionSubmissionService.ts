import { createHash, randomUUID } from "node:crypto";

import type { TransactionOperationRepository } from "../../repositories/transactionOperationRepository.js";
import { InvalidOperationError, OperationConflictError, OperationNotFoundError } from "./types.js";
import type {
  CreateOperationInput,
  LedgerGateway,
  LendingAction,
  OperationStatus,
  TransactionOperation,
} from "./types.js";

export interface SubmitOperationInput {
  operationId: string;
  action: LendingAction;
  account: string;
  payload: unknown;
  signedTransaction: string;
}

export interface OperationResult {
  operation: TransactionOperation;
  replayed: boolean;
}

export interface ReconciliationResult {
  checked: number;
  confirmed: number;
  stillPending: number;
  retryable: number;
  terminal: number;
}

type OperationWork = Promise<OperationResult>;

/**
 * Coordinates durable operation state with a ledger adapter.
 *
 * The repository's unique operation id is the cross-restart idempotency
 * boundary. The process-local work map closes the race between two requests
 * arriving before the first database transaction is visible; the unique
 * database constraint remains the authority across processes.
 */
export class TransactionSubmissionService {
  private readonly inFlight = new Map<string, OperationWork>();

  constructor(
    private readonly repository: TransactionOperationRepository,
    private readonly ledger: LedgerGateway,
  ) {}

  async submit(input: SubmitOperationInput): Promise<OperationResult> {
    validateInput(input);
    const payloadHash = fingerprint({
      action: input.action,
      account: input.account,
      payload: input.payload,
      signedTransaction: input.signedTransaction,
    });
    const existing = await this.repository.find(input.operationId);

    if (existing) {
      assertSamePayload(existing, payloadHash);
      if (existing.status === "confirmed" || existing.status === "submitted") {
        return { operation: existing, replayed: true };
      }
      if (existing.status === "terminal_failed") {
        return { operation: existing, replayed: true };
      }
    }

    const running = this.inFlight.get(input.operationId);
    if (running) return running;

    const work = this.submitOnce(input, payloadHash);
    this.inFlight.set(input.operationId, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(input.operationId);
    }
  }

  async get(operationId: string): Promise<TransactionOperation> {
    const operation = await this.repository.find(operationId);
    if (!operation) throw new OperationNotFoundError(operationId);
    return operation;
  }

  async reconcile(): Promise<ReconciliationResult> {
    const candidates = await this.repository.recoverable();
    const result: ReconciliationResult = {
      checked: candidates.length,
      confirmed: 0,
      stillPending: 0,
      retryable: 0,
      terminal: 0,
    };

    for (const operation of candidates) {
      let inspectOperation = operation;
      if (operation.status === "pending") {
        const claimed = await this.repository.claim(
          operation.operationId,
          randomUUID(),
          new Date(Date.now() + 30_000),
        );
        if (!claimed) continue;
        inspectOperation = claimed;
      }
      const observation = await this.ledger.inspect(inspectOperation);
      const checkedAt = new Date();
      if (observation.state === "confirmed") {
        await this.repository.update(inspectOperation.operationId, {
          status: "confirmed",
          ledgerTransaction: observation.transactionHash,
          failureCode: null,
          failureMessage: null,
          lastCheckedAt: checkedAt,
          submissionLeaseToken: null,
          submissionLeaseUntil: null,
        });
        result.confirmed += 1;
      } else if (observation.state === "pending") {
        await this.repository.update(inspectOperation.operationId, {
          status: "submitted",
          lastCheckedAt: checkedAt,
          submissionLeaseToken: null,
          submissionLeaseUntil: null,
        });
        result.stillPending += 1;
      } else if (observation.state === "retryable_failed") {
        await this.repository.update(inspectOperation.operationId, {
          status: "retryable_failed",
          failureCode: observation.code,
          failureMessage: observation.message,
          lastCheckedAt: checkedAt,
          submissionLeaseToken: null,
          submissionLeaseUntil: null,
        });
        result.retryable += 1;
      } else {
        await this.repository.update(inspectOperation.operationId, {
          status: "terminal_failed",
          failureCode: observation.code,
          failureMessage: observation.message,
          lastCheckedAt: checkedAt,
          submissionLeaseToken: null,
          submissionLeaseUntil: null,
        });
        result.terminal += 1;
      }
    }

    return result;
  }

  private async submitOnce(
    input: SubmitOperationInput,
    payloadHash: string,
  ): Promise<OperationResult> {
    let operation = await this.repository.find(input.operationId);
    if (!operation) {
      const createInput: CreateOperationInput = {
        operationId: input.operationId,
        action: input.action,
        account: input.account,
        payloadHash,
        signedTransaction: input.signedTransaction,
      };
      try {
        operation = await this.repository.create(createInput);
      } catch {
        operation = await this.repository.find(input.operationId);
        if (!operation) throw new Error("Operation reservation was lost.");
        assertSamePayload(operation, payloadHash);
      }
    }

    if (operation.status === "confirmed" || operation.status === "submitted") {
      return { operation, replayed: true };
    }
    if (operation.status === "terminal_failed") {
      return { operation, replayed: true };
    }

    const leaseToken = randomUUID();
    const claimed = await this.repository.claim(
      operation.operationId,
      leaseToken,
      new Date(Date.now() + 30_000),
    );
    if (!claimed) {
      const current = await this.repository.find(operation.operationId);
      return { operation: current ?? operation, replayed: true };
    }
    operation = claimed;

    const attemptCount = operation.attemptCount + 1;
    await this.repository.update(operation.operationId, {
      status: "pending",
      attemptCount,
      failureCode: null,
      failureMessage: null,
      submissionLeaseToken: leaseToken,
      submissionLeaseUntil: new Date(Date.now() + 30_000),
    });

    try {
      const submission = await this.ledger.submit({
        ...operation,
        attemptCount,
        status: "pending",
      });
      const updated = await this.repository.update(operation.operationId, {
        status: "submitted",
        attemptCount,
        ledgerTransaction: submission.transactionHash,
        failureCode: null,
        failureMessage: null,
        submissionLeaseToken: null,
        submissionLeaseUntil: null,
      });
      return { operation: updated, replayed: false };
    } catch (error) {
      const failure = classifySubmissionError(error);
      const updated = await this.repository.update(operation.operationId, {
        status: failure.status,
        attemptCount,
        failureCode: failure.code,
        failureMessage: failure.message,
        submissionLeaseToken: null,
        submissionLeaseUntil: null,
      });
      return { operation: updated, replayed: false };
    }
  }
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

function validateInput(input: SubmitOperationInput): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(input.operationId)) {
    throw new InvalidOperationError(
      "operationId must be 1-128 characters using letters, numbers, :, _, or -.",
    );
  }
  if (!input.account.trim() || input.account.length > 56) {
    throw new InvalidOperationError("account must be a non-empty Stellar address.");
  }
  if (!input.signedTransaction.trim()) {
    throw new InvalidOperationError("signedTransaction is required.");
  }
}

function assertSamePayload(operation: TransactionOperation, payloadHash: string): void {
  if (operation.payloadHash !== payloadHash) {
    throw new OperationConflictError(operation.operationId);
  }
}

function classifySubmissionError(error: unknown): {
  status: Extract<OperationStatus, "retryable_failed" | "terminal_failed">;
  code: string;
  message: string;
} {
  if (error instanceof Error && error.name === "TerminalLedgerError") {
    return {
      status: "terminal_failed",
      code: "LEDGER_TERMINAL_FAILURE",
      message: error.message,
    };
  }
  return {
    status: "retryable_failed",
    code: "LEDGER_RETRYABLE_FAILURE",
    message: error instanceof Error ? error.message : "Ledger submission failed.",
  };
}
