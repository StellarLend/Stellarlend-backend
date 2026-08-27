/**
 * Transaction-producing lending routes.
 *
 * Clients provide an operation id, a signed transaction envelope, and the
 * action payload. The server persists the operation before invoking the
 * configured ledger adapter, making retries safe across request timeouts and
 * process restarts. Signing remains client-side; private keys never reach the
 * backend.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  InMemoryTransactionOperationRepository,
  PrismaTransactionOperationRepository,
} from "../repositories/transactionOperationRepository.js";
import { prisma } from "../lib/prisma.js";
import { UnavailableLedgerGateway } from "../services/transaction/unavailableLedgerGateway.js";
import {
  InvalidOperationError,
  LENDING_ACTIONS,
  OperationConflictError,
  OperationNotFoundError,
} from "../services/transaction/types.js";
import type { LendingAction } from "../services/transaction/types.js";
import {
  TransactionSubmissionService,
  type SubmitOperationInput,
} from "../services/transaction/transactionSubmissionService.js";

const operationBody = z.object({
  operationId: z.string().min(1).max(128),
  account: z.string().min(1).max(56),
  payload: z.record(z.string(), z.unknown()),
  signedTransaction: z.string().min(1),
});

const defaultRepository =
  env.NODE_ENV === "test"
    ? new InMemoryTransactionOperationRepository()
    : new PrismaTransactionOperationRepository(prisma);

let transactionService = new TransactionSubmissionService(
  defaultRepository,
  new UnavailableLedgerGateway(),
);

/** Replace the adapter in tests or during application composition. */
export function configureTransactionService(service: TransactionSubmissionService): void {
  transactionService = service;
}
import { validateProtocolInput } from "../validation/protocolInput.js";

export const lendingRouter = Router();

for (const action of LENDING_ACTIONS) {
  lendingRouter.post(`/${action}`, (req, res, next) => {
    // Keep the durable operation API and the earlier protocol-validation
    // boundary available on the same action routes.
    if (isTransactionRequest(req.body)) {
      void submitAction(action, req, res).catch(next);
      return;
    }
    validateProtocolInput(req, res, () => notImplemented(action)(req, res));
  });
}

lendingRouter.get("/operations/:operationId", (req, res, next) => {
  void (async () => {
    try {
      const operation = await transactionService.get(req.params.operationId);
      res.status(200).json({ operation: serializeOperation(operation) });
    } catch (error) {
      if (error instanceof OperationNotFoundError) {
        next(new AppError(error.code, error.message, 404));
        return;
      }
      next(error);
    }
  })();
});

lendingRouter.post("/operations/reconcile", (_req, res, next) => {
  void (async () => {
    try {
      const result = await transactionService.reconcile();
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  })();
});

async function submitAction(action: LendingAction, req: Request, res: Response): Promise<void> {
  const parsed = operationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "INVALID_OPERATION",
        message: parsed.error.issues.map((issue) => issue.message).join(", "),
      },
    });
    return;
  }

  const input: SubmitOperationInput = { action, ...parsed.data };
  try {
    const result = await transactionService.submit(input);
    const status = result.operation.status === "confirmed" ? 200 : 202;
    res.status(status).json({
      operation: serializeOperation(result.operation),
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof OperationConflictError) {
      res.status(409).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof InvalidOperationError) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof OperationNotFoundError) {
      res.status(404).json({ error: { code: error.code, message: error.message } });
      return;
    }
    throw error;
  }
}

function serializeOperation(operation: Awaited<ReturnType<TransactionSubmissionService["get"]>>) {
  return {
    operationId: operation.operationId,
    action: operation.action,
    account: operation.account,
    status: operation.status,
    attemptCount: operation.attemptCount,
    ledgerTransaction: operation.ledgerTransaction,
    failureCode: operation.failureCode,
    failureMessage: operation.failureMessage,
    lastCheckedAt: operation.lastCheckedAt?.toISOString() ?? null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  };
}

function isTransactionRequest(body: unknown): body is { operationId: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "operationId" in body &&
    typeof body.operationId === "string"
  );
}

function notImplemented(action: LendingAction) {
  return (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: `The "${action}" lending action is not implemented yet.`,
      },
    });
  };
}
