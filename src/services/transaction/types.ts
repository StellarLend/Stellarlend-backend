export const LENDING_ACTIONS = ["deposit", "borrow", "repay", "withdraw", "liquidate"] as const;

export type LendingAction = (typeof LENDING_ACTIONS)[number];

export const OPERATION_STATUSES = [
  "pending",
  "submitted",
  "confirmed",
  "retryable_failed",
  "terminal_failed",
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export interface TransactionOperation {
  operationId: string;
  action: LendingAction;
  account: string;
  payloadHash: string;
  signedTransaction: string;
  status: OperationStatus;
  attemptCount: number;
  submissionLeaseToken: string | null;
  submissionLeaseUntil: Date | null;
  ledgerTransaction: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOperationInput {
  operationId: string;
  action: LendingAction;
  account: string;
  payloadHash: string;
  signedTransaction: string;
}

export interface OperationPatch {
  status: OperationStatus;
  attemptCount?: number;
  submissionLeaseToken?: string | null;
  submissionLeaseUntil?: Date | null;
  ledgerTransaction?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  lastCheckedAt?: Date | null;
}

export interface LedgerSubmission {
  transactionHash: string;
}

export type LedgerObservation =
  | { state: "pending" }
  | { state: "confirmed"; transactionHash: string }
  | { state: "retryable_failed"; code: string; message: string }
  | { state: "terminal_failed"; code: string; message: string };

export interface LedgerGateway {
  submit(operation: TransactionOperation): Promise<LedgerSubmission>;
  inspect(operation: TransactionOperation): Promise<LedgerObservation>;
}

export class OperationConflictError extends Error {
  readonly code = "OPERATION_PAYLOAD_CONFLICT";

  constructor(operationId: string) {
    super(`Operation ${operationId} was already used with a different payload.`);
    this.name = "OperationConflictError";
  }
}

export class OperationNotFoundError extends Error {
  readonly code = "OPERATION_NOT_FOUND";

  constructor(operationId: string) {
    super(`Operation ${operationId} does not exist.`);
    this.name = "OperationNotFoundError";
  }
}

export class InvalidOperationError extends Error {
  readonly code = "INVALID_OPERATION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}
