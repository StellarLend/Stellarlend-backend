import { describe, expect, it } from "vitest";

import { InMemoryTransactionOperationRepository } from "../src/repositories/transactionOperationRepository.js";
import {
  TransactionSubmissionService,
  canonicalJson,
  fingerprint,
} from "../src/services/transaction/transactionSubmissionService.js";
import type {
  LedgerGateway,
  LedgerObservation,
  LedgerSubmission,
  TransactionOperation,
} from "../src/services/transaction/types.js";

const input = {
  operationId: "deposit:account-1:001",
  action: "deposit" as const,
  account: "GTESTACCOUNT",
  payload: { asset: "USDC", amount: "100" },
  signedTransaction: "signed-xdr-001",
};

class FakeLedger implements LedgerGateway {
  submitCount = 0;
  inspectCount = 0;
  submission: LedgerSubmission = { transactionHash: "tx-001" };
  observation: LedgerObservation = { state: "pending" };
  submitError: Error | null = null;

  async submit(_operation: TransactionOperation): Promise<LedgerSubmission> {
    this.submitCount += 1;
    if (this.submitError) throw this.submitError;
    return this.submission;
  }

  async inspect(_operation: TransactionOperation): Promise<LedgerObservation> {
    this.inspectCount += 1;
    return this.observation;
  }
}

function serviceFor(ledger = new FakeLedger()) {
  const repository = new InMemoryTransactionOperationRepository();
  return {
    ledger,
    repository,
    service: new TransactionSubmissionService(repository, ledger),
  };
}

describe("canonical transaction operation identity", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: [2, 1] })).toBe(
      '{"a":[2,1],"nested":{"a":1,"b":2},"z":1}',
    );
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
    expect(fingerprint({ a: [1, 2] })).not.toBe(fingerprint({ a: [2, 1] }));
  });
});

describe("TransactionSubmissionService", () => {
  it("submits an operation once and replays the durable result", async () => {
    const { service, ledger } = serviceFor();

    const first = await service.submit(input);
    const second = await service.submit(input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(first.operation.status).toBe("submitted");
    expect(second.operation.ledgerTransaction).toBe("tx-001");
    expect(ledger.submitCount).toBe(1);
  });

  it("rejects operation-id reuse with a changed payload", async () => {
    const { service, ledger } = serviceFor();
    await service.submit(input);

    await expect(
      service.submit({
        ...input,
        payload: { asset: "USDC", amount: "101" },
      }),
    ).rejects.toMatchObject({ code: "OPERATION_PAYLOAD_CONFLICT" });
    expect(ledger.submitCount).toBe(1);
  });

  it("rejects operation-id reuse with a changed signed transaction", async () => {
    const { service, ledger } = serviceFor();
    await service.submit(input);

    await expect(
      service.submit({ ...input, signedTransaction: "different-xdr" }),
    ).rejects.toMatchObject({ code: "OPERATION_PAYLOAD_CONFLICT" });
    expect(ledger.submitCount).toBe(1);
  });

  it("records a retryable ledger failure and retries it once later", async () => {
    const ledger = new FakeLedger();
    ledger.submitError = new Error("RPC timeout");
    const { service } = serviceFor(ledger);

    const failed = await service.submit(input);
    expect(failed.operation.status).toBe("retryable_failed");
    expect(failed.operation.attemptCount).toBe(1);

    ledger.submitError = null;
    const retried = await service.submit(input);
    expect(retried.operation.status).toBe("submitted");
    expect(retried.operation.attemptCount).toBe(2);
    expect(ledger.submitCount).toBe(2);
  });

  it("does not retry a terminal ledger failure", async () => {
    const ledger = new FakeLedger();
    ledger.submitError = Object.assign(new Error("bad sequence"), {
      name: "TerminalLedgerError",
    });
    const { service } = serviceFor(ledger);

    const failed = await service.submit(input);
    const replay = await service.submit(input);

    expect(failed.operation.status).toBe("terminal_failed");
    expect(replay.replayed).toBe(true);
    expect(ledger.submitCount).toBe(1);
  });

  it("reconciles a delayed confirmation after a service restart", async () => {
    const repository = new InMemoryTransactionOperationRepository();
    const firstLedger = new FakeLedger();
    const first = new TransactionSubmissionService(repository, firstLedger);
    await first.submit(input);

    const restartedLedger = new FakeLedger();
    restartedLedger.observation = {
      state: "confirmed",
      transactionHash: "tx-confirmed-after-restart",
    };
    const restarted = new TransactionSubmissionService(repository, restartedLedger);
    const result = await restarted.reconcile();
    const operation = await restarted.get(input.operationId);

    expect(result).toMatchObject({ checked: 1, confirmed: 1 });
    expect(operation.status).toBe("confirmed");
    expect(operation.ledgerTransaction).toBe("tx-confirmed-after-restart");
    expect(restartedLedger.inspectCount).toBe(1);
  });

  it("does not submit a pending row while another worker holds its lease", async () => {
    const repository = new InMemoryTransactionOperationRepository();
    const ledger = new FakeLedger();
    const first = new TransactionSubmissionService(repository, ledger);
    await repository.create({
      operationId: input.operationId,
      action: input.action,
      account: input.account,
      payloadHash: fingerprint({
        action: input.action,
        account: input.account,
        payload: input.payload,
        signedTransaction: input.signedTransaction,
      }),
      signedTransaction: input.signedTransaction,
    });
    const claimed = await repository.claim(
      input.operationId,
      "worker-a",
      new Date(Date.now() + 30_000),
    );
    expect(claimed?.submissionLeaseToken).toBe("worker-a");

    const replay = await first.submit(input);

    expect(replay.replayed).toBe(true);
    expect(replay.operation.status).toBe("pending");
    expect(ledger.submitCount).toBe(0);
  });

  it("leaves a pending operation submitted during reconciliation", async () => {
    const repository = new InMemoryTransactionOperationRepository();
    const firstLedger = new FakeLedger();
    const first = new TransactionSubmissionService(repository, firstLedger);
    await first.submit(input);
    const restartedLedger = new FakeLedger();
    restartedLedger.observation = { state: "pending" };
    const restarted = new TransactionSubmissionService(repository, restartedLedger);

    const result = await restarted.reconcile();
    const operation = await restarted.get(input.operationId);

    expect(result.stillPending).toBe(1);
    expect(operation.status).toBe("submitted");
  });

  it("records terminal and retryable reconciliation failures distinctly", async () => {
    const repository = new InMemoryTransactionOperationRepository();
    const first = new FakeLedger();
    const original = new TransactionSubmissionService(repository, first);
    await original.submit({ ...input, operationId: "op-retry" });
    await original.submit({ ...input, operationId: "op-terminal" });

    const ledger = new FakeLedger();
    let calls = 0;
    ledger.inspect = async () => {
      calls += 1;
      return calls === 1
        ? { state: "retryable_failed", code: "TEMP", message: "try again" }
        : { state: "terminal_failed", code: "BAD", message: "do not retry" };
    };
    const restarted = new TransactionSubmissionService(repository, ledger);
    const result = await restarted.reconcile();

    expect(result).toMatchObject({ checked: 2, retryable: 1, terminal: 1 });
    expect((await restarted.get("op-retry")).status).toBe("retryable_failed");
    expect((await restarted.get("op-terminal")).status).toBe("terminal_failed");
  });
});
