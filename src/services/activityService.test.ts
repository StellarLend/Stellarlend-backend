import { beforeEach, describe, expect, it } from "vitest";
import { clearActivity, listActivity, recordActivity } from "./activityService.js";

describe("activity cursor API", () => {
  beforeEach(() => {
    clearActivity();
    recordActivity({ id: "evt-1", type: "deposit", account: "G1", assetId: "usdc", amount: "10", occurredAt: "2026-08-30T00:00:00.000Z", ledger: 1 });
    recordActivity({ id: "evt-2", type: "borrow", account: "G1", assetId: "usdc", amount: "5", occurredAt: "2026-08-30T00:01:00.000Z", ledger: 2 });
    recordActivity({ id: "evt-3", type: "deposit", account: "G2", assetId: "xlm", amount: "7", occurredAt: "2026-08-30T00:02:00.000Z", ledger: 3 });
  });

  it("filters by account and type while returning cursor metadata", () => {
    const result = listActivity({ account: "G1", type: "deposit", limit: 1 });
    expect(result.data.map((event) => event.id)).toEqual(["evt-1"]);
    expect(result.pagination.hasMore).toBe(false);
    expect(result.pagination.nextCursor).toBeNull();
  });

  it("returns a consistent snapshot across a refresh", () => {
    const first = listActivity({ limit: 1, snapshot: "2026-08-30T00:01:30.000Z" });
    expect(first.data.map((event) => event.id)).toEqual(["evt-2"]);
    recordActivity({ id: "evt-new", type: "deposit", account: "G1", assetId: "usdc", amount: "100", occurredAt: "2026-08-30T00:03:00.000Z", ledger: 4 });
    const second = listActivity({ limit: 2, cursor: first.pagination.nextCursor ?? undefined });
    expect(second.data.map((event) => event.id)).toEqual(["evt-1"]);
  });

  it("deduplicates indexer replays by event ID", () => {
    const original = listActivity({ limit: 10 });
    recordActivity({ id: "evt-2", type: "borrow", account: "G1", assetId: "usdc", amount: "5", occurredAt: "2026-08-30T00:01:00.000Z", ledger: 2 });
    expect(listActivity({ limit: 10 }).data).toHaveLength(original.data.length);
  });
});
