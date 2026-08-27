import { describe, expect, it } from "vitest";
import {
  ConsistentPositionService,
  InMemorySnapshotCache,
  PortfolioConsistencyError,
  type PositionDatabase,
  type PositionRow,
} from "./consistentPositionService.js";

class FakeDatabase implements PositionDatabase {
  version = 1;
  accountExists = true;
  positions: PositionRow[] = [];
  transactions = 0;
  failSerialization = 0;
  failMutation = false;

  async transaction<T>(
    callback: (
      transaction: Parameters<PositionDatabase["transaction"]>[0] extends (
        t: infer T,
      ) => Promise<unknown>
        ? T
        : never,
    ) => Promise<T>,
    _options: { isolationLevel: "serializable" },
  ): Promise<T> {
    this.transactions += 1;
    if (this.failSerialization > 0) {
      this.failSerialization -= 1;
      throw Object.assign(new Error("serialization conflict"), { code: "40001" });
    }
    const working = this.positions.map((position) => ({ ...position }));
    const workingVersion = this.version;
    const transaction = {
      getAccountForUpdate: async () =>
        this.accountExists ? { id: "account-1", portfolioVersion: workingVersion } : null,
      listPositions: async () => working.map((position) => ({ ...position })),
      updatePosition: async (input: {
        accountId: string;
        asset: string;
        collateralDelta: bigint;
        debtDelta: bigint;
      }) => {
        if (this.failMutation) throw new Error("mutation failed");
        let position = working.find((entry) => entry.asset === input.asset);
        if (!position) {
          position = {
            id: `position-${input.asset}`,
            accountId: input.accountId,
            asset: input.asset,
            collateralAmount: 0n,
            debtAmount: 0n,
            version: 1,
          };
          working.push(position);
        }
        position.collateralAmount += input.collateralDelta;
        position.debtAmount += input.debtDelta;
        position.version += 1;
        return { ...position };
      },
      incrementPortfolioVersion: async (_accountId: string, expected: number) => {
        if (workingVersion !== expected)
          throw new PortfolioConsistencyError("VERSION_CONFLICT", "portfolio changed");
        this.version = expected + 1;
        return this.version;
      },
    };
    const result = await callback(transaction);
    this.positions = working;
    return result;
  }
}

function makeService(database: FakeDatabase, cache = new InMemorySnapshotCache()) {
  return {
    service: new ConsistentPositionService(
      database,
      cache,
      () => 100,
      async () => undefined,
    ),
    cache,
  };
}

describe("consistent position snapshots", () => {
  it("reads account revision and positions in one serializable transaction", async () => {
    const database = new FakeDatabase();
    database.positions = [
      {
        id: "z",
        accountId: "account-1",
        asset: "Z",
        collateralAmount: 1n,
        debtAmount: 0n,
        version: 1,
      },
      {
        id: "a",
        accountId: "account-1",
        asset: "A",
        collateralAmount: 2n,
        debtAmount: 0n,
        version: 1,
      },
    ];
    const { service } = makeService(database);
    const snapshot = await service.readPortfolio("account-1");
    expect(snapshot.version).toBe(1);
    expect(snapshot.positions.map((position) => position.asset)).toEqual(["A", "Z"]);
    expect(database.transactions).toBe(1);
  });

  it("returns cached snapshots without combining a second read", async () => {
    const database = new FakeDatabase();
    const { service, cache } = makeService(database);
    await service.readPortfolio("account-1");
    expect(cache.size).toBe(1);
    await service.readPortfolio("account-1");
    expect(database.transactions).toBe(1);
  });

  it("serializes a mutation, increments the revision, and refreshes cache after commit", async () => {
    const database = new FakeDatabase();
    const { service } = makeService(database);
    const before = await service.readPortfolio("account-1");
    const after = await service.mutatePosition({
      accountId: "account-1",
      asset: "XLM",
      collateralDelta: 10n,
      debtDelta: 2n,
      expectedPortfolioVersion: before.version,
    });
    expect(after.version).toBe(2);
    expect(after.positions[0]?.collateralAmount).toBe(10n);
    expect(database.version).toBe(2);
  });

  it("fails safely on a stale optimistic version", async () => {
    const database = new FakeDatabase();
    const { service } = makeService(database);
    await expect(
      service.mutatePosition({
        accountId: "account-1",
        asset: "XLM",
        collateralDelta: 1n,
        debtDelta: 0n,
        expectedPortfolioVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("does not invalidate the cache when a transaction rolls back", async () => {
    const database = new FakeDatabase();
    const { service, cache } = makeService(database);
    await service.readPortfolio("account-1");
    database.failMutation = true;
    await expect(
      service.mutatePosition({
        accountId: "account-1",
        asset: "XLM",
        collateralDelta: 1n,
        debtDelta: 0n,
        expectedPortfolioVersion: 1,
      }),
    ).rejects.toThrow("mutation failed");
    expect(cache.get("account-1")?.version).toBe(1);
    expect(database.version).toBe(1);
  });

  it("retries serialization conflicts and commits only after a successful attempt", async () => {
    const database = new FakeDatabase();
    database.failSerialization = 2;
    const { service } = makeService(database);
    const result = await service.mutatePosition({
      accountId: "account-1",
      asset: "XLM",
      collateralDelta: 1n,
      debtDelta: 0n,
      expectedPortfolioVersion: 1,
    });
    expect(result.version).toBe(2);
    expect(database.transactions).toBe(3);
  });

  it("rejects negative balance deltas with a typed error before touching the database", async () => {
    const database = new FakeDatabase();
    const { service } = makeService(database);
    await expect(
      service.mutatePosition({
        accountId: "account-1",
        asset: "XLM",
        collateralDelta: -1n,
        debtDelta: 0n,
        expectedPortfolioVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_BALANCE" });
    expect(database.transactions).toBe(0);
  });

  it("reports missing accounts without leaking database errors", async () => {
    const database = new FakeDatabase();
    database.accountExists = false;
    const { service } = makeService(database);
    await expect(service.readPortfolio("missing")).rejects.toBeInstanceOf(
      PortfolioConsistencyError,
    );
  });

  it("stops retrying after the bounded serialization budget", async () => {
    const database = new FakeDatabase();
    database.failSerialization = 10;
    const { service } = makeService(database);
    await expect(
      service.mutatePosition({
        accountId: "account-1",
        asset: "XLM",
        collateralDelta: 1n,
        debtDelta: 0n,
        expectedPortfolioVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "40001" });
    expect(database.transactions).toBe(3);
  });

  it("returns defensive cache copies that cannot rewrite a snapshot", async () => {
    const database = new FakeDatabase();
    const { service, cache } = makeService(database);
    const snapshot = await service.readPortfolio("account-1");
    const cached = cache.get("account-1");
    expect(cached).toBeDefined();
    if (cached) {
      (cached.positions as PositionRow[]).push({
        id: "bad",
        accountId: "account-1",
        asset: "BAD",
        collateralAmount: 0n,
        debtAmount: 0n,
        version: 1,
      });
    }
    expect((await service.readPortfolio("account-1")).positions).toEqual(snapshot.positions);
  });

  it("increments a position revision inside the same mutation boundary", async () => {
    const database = new FakeDatabase();
    const { service } = makeService(database);
    const result = await service.mutatePosition({
      accountId: "account-1",
      asset: "XLM",
      collateralDelta: 3n,
      debtDelta: 1n,
      expectedPortfolioVersion: 1,
    });
    expect(result.positions[0]?.version).toBe(2);
    expect(result.positions[0]?.debtAmount).toBe(1n);
  });

  it("does not classify domain conflicts as serialization retries", async () => {
    const database = new FakeDatabase();
    const { service } = makeService(database);
    await expect(
      service.mutatePosition({
        accountId: "account-1",
        asset: "XLM",
        collateralDelta: 0n,
        debtDelta: 0n,
        expectedPortfolioVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(database.transactions).toBe(1);
  });
});
