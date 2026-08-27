import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { InMemoryTransactionOperationRepository } from "../../src/repositories/transactionOperationRepository.js";
import { configureTransactionService } from "../../src/routes/lending.js";
import { TransactionSubmissionService } from "../../src/services/transaction/transactionSubmissionService.js";
import type {
  LedgerGateway,
  LedgerObservation,
  LedgerSubmission,
  TransactionOperation,
} from "../../src/services/transaction/types.js";

class RouteLedger implements LedgerGateway {
  submitCount = 0;
  observation: LedgerObservation = { state: "pending" };

  async submit(_operation: TransactionOperation): Promise<LedgerSubmission> {
    this.submitCount += 1;
    return { transactionHash: `tx-${this.submitCount}` };
  }

  async inspect(_operation: TransactionOperation): Promise<LedgerObservation> {
    return this.observation;
  }
}

function freshRoute() {
  const repository = new InMemoryTransactionOperationRepository();
  const ledger = new RouteLedger();
  configureTransactionService(new TransactionSubmissionService(repository, ledger));
  return { app: createApp(), ledger };
}

const body = {
  operationId: "borrow:account-1:001",
  account: "GTESTACCOUNT",
  payload: { asset: "USDC", amount: "25" },
  signedTransaction: "signed-xdr",
};

describe.sequential("lending transaction routes", () => {
  beforeEach(() => {
    freshRoute();
  });

  it("returns an accepted operation and replays duplicate requests", async () => {
    const { app, ledger } = freshRoute();

    const first = await request(app).post("/api/v1/lending/borrow").send(body);
    const second = await request(app).post("/api/v1/lending/borrow").send(body);

    expect(first.status).toBe(202);
    expect(first.body.operation).toMatchObject({
      operationId: body.operationId,
      action: "borrow",
      status: "submitted",
      attemptCount: 1,
      ledgerTransaction: "tx-1",
    });
    expect(second.status).toBe(202);
    expect(second.body.replayed).toBe(true);
    expect(ledger.submitCount).toBe(1);
  });

  it("rejects a conflicting payload without a second ledger call", async () => {
    const { app, ledger } = freshRoute();
    await request(app).post("/api/v1/lending/deposit").send(body);

    const response = await request(app)
      .post("/api/v1/lending/deposit")
      .send({ ...body, payload: { ...body.payload, amount: "26" } });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("OPERATION_PAYLOAD_CONFLICT");
    expect(ledger.submitCount).toBe(1);
  });

  it("returns operation status and reconciles delayed confirmation", async () => {
    const { app, ledger } = freshRoute();
    await request(app).post("/api/v1/lending/repay").send(body);

    const before = await request(app).get(`/api/v1/lending/operations/${body.operationId}`);
    expect(before.status).toBe(200);
    expect(before.body.operation.status).toBe("submitted");

    ledger.observation = {
      state: "confirmed",
      transactionHash: "tx-confirmed",
    };
    const reconciled = await request(app).post("/api/v1/lending/operations/reconcile").send({});
    expect(reconciled.status).toBe(200);
    expect(reconciled.body).toMatchObject({ checked: 1, confirmed: 1 });

    const after = await request(app).get(`/api/v1/lending/operations/${body.operationId}`);
    expect(after.body.operation).toMatchObject({
      status: "confirmed",
      ledgerTransaction: "tx-confirmed",
    });
  });

  it("validates the operation envelope before touching the ledger", async () => {
    const { app, ledger } = freshRoute();

    const response = await request(app)
      .post("/api/v1/lending/withdraw")
      .send({ operationId: "bad id", account: "", payload: {} });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_OPERATION");
    expect(ledger.submitCount).toBe(0);
  });

  it("returns a stable not-found response for unknown operations", async () => {
    const { app } = freshRoute();
    const response = await request(app).get("/api/v1/lending/operations/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("OPERATION_NOT_FOUND");
  });
});
