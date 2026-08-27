import { describe, expect, it, vi } from "vitest";
import { DurableRetryQueue, PermanentJobError, retryDelayMs, type RetryJobStore } from "../src/services/retryQueue.js";

function store(): RetryJobStore & { job: any } {
  const value: any = { id: "job-1", kind: "ledger_sync", payload: { ledger: 4 }, attempts: 0, maxAttempts: 2 };
  return {
    job: value,
    enqueue: vi.fn(async () => value), claim: vi.fn(async () => value), succeed: vi.fn(async () => {}),
    retry: vi.fn(async () => {}), deadLetter: vi.fn(async () => {}), replay: vi.fn(async () => {}),
  };
}

describe("DurableRetryQueue", () => {
  it("caps exponential backoff", () => expect(retryDelayMs(100, () => 0.5)).toBeLessThanOrEqual(15 * 60 * 1000));
  it("requeues transient failures and dead-letters permanent failures", async () => {
    const transient = store();
    const queue = new DurableRetryQueue(transient, () => new Date("2026-08-27T00:00:00Z"));
    expect(await queue.processOnce(async () => { throw new Error("rpc timeout"); })).toBe("retrying");
    expect(transient.retry).toHaveBeenCalled();

    const permanent = store();
    const permanentQueue = new DurableRetryQueue(permanent);
    expect(await permanentQueue.processOnce(async () => { throw new PermanentJobError("invalid payload"); })).toBe("dead_letter");
    expect(permanent.deadLetter).toHaveBeenCalledWith("job-1", "invalid payload");
  });
  it("supports explicit dead-letter replay", async () => {
    const persisted = store();
    await new DurableRetryQueue(persisted).replay("job-1");
    expect(persisted.replay).toHaveBeenCalledWith("job-1");
  });
});
