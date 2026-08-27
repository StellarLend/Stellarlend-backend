export type PositionRow = {
  id: string;
  accountId: string;
  asset: string;
  collateralAmount: bigint;
  debtAmount: bigint;
  version: number;
};

export type PortfolioSnapshot = {
  accountId: string;
  version: number;
  capturedAt: number;
  positions: readonly PositionRow[];
};

export type PositionMutation = {
  accountId: string;
  asset: string;
  collateralDelta: bigint;
  debtDelta: bigint;
  expectedPortfolioVersion: number;
};

export type AccountRevision = { id: string; portfolioVersion: number };
export type TransactionOptions = { isolationLevel: "serializable" };

export type PositionTransaction = {
  getAccountForUpdate(accountId: string): Promise<AccountRevision | null>;
  listPositions(accountId: string): Promise<PositionRow[]>;
  updatePosition(input: {
    accountId: string;
    asset: string;
    collateralDelta: bigint;
    debtDelta: bigint;
  }): Promise<PositionRow>;
  incrementPortfolioVersion(accountId: string, expectedVersion: number): Promise<number>;
};

export type PositionDatabase = {
  transaction<T>(
    callback: (transaction: PositionTransaction) => Promise<T>,
    options: TransactionOptions,
  ): Promise<T>;
};

export type SnapshotCache = {
  get(accountId: string): PortfolioSnapshot | undefined;
  set(snapshot: PortfolioSnapshot): void;
  delete(accountId: string): void;
};

export class PortfolioConsistencyError extends Error {
  constructor(
    public readonly code: "ACCOUNT_NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_BALANCE",
    message: string,
  ) {
    super(message);
    this.name = "PortfolioConsistencyError";
  }
}

const SERIALIZATION_CODES = new Set(["40001", "40P01", "P2034"]);

export function isSerializationConflict(error: unknown): boolean {
  if (error instanceof PortfolioConsistencyError) return false;
  if (error !== null && typeof error === "object" && "code" in error) {
    return SERIALIZATION_CODES.has(String(error.code));
  }
  return false;
}

export class InMemorySnapshotCache implements SnapshotCache {
  private readonly values = new Map<string, PortfolioSnapshot>();

  get(accountId: string): PortfolioSnapshot | undefined {
    const value = this.values.get(accountId);
    return value ? structuredClone(value) : undefined;
  }

  set(snapshot: PortfolioSnapshot): void {
    this.values.set(snapshot.accountId, structuredClone(snapshot));
  }

  delete(accountId: string): void {
    this.values.delete(accountId);
  }

  get size(): number {
    return this.values.size;
  }
}

export class ConsistentPositionService {
  constructor(
    private readonly database: PositionDatabase,
    private readonly cache: SnapshotCache,
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async readPortfolio(accountId: string): Promise<PortfolioSnapshot> {
    const cached = this.cache.get(accountId);
    if (cached) return cached;
    const snapshot = await this.database.transaction(
      async (transaction) => {
        const account = await transaction.getAccountForUpdate(accountId);
        if (!account)
          throw new PortfolioConsistencyError("ACCOUNT_NOT_FOUND", "account was not found");
        const positions = await transaction.listPositions(accountId);
        return this.snapshot(accountId, account.portfolioVersion, positions);
      },
      { isolationLevel: "serializable" },
    );
    this.cache.set(snapshot);
    return snapshot;
  }

  async mutatePosition(input: PositionMutation): Promise<PortfolioSnapshot> {
    if (input.collateralDelta < 0n || input.debtDelta < 0n) {
      throw new PortfolioConsistencyError(
        "INVALID_BALANCE",
        "position balances cannot become negative",
      );
    }
    let attempt = 0;
    while (true) {
      try {
        const snapshot = await this.database.transaction(
          async (transaction) => {
            const account = await transaction.getAccountForUpdate(input.accountId);
            if (!account)
              throw new PortfolioConsistencyError("ACCOUNT_NOT_FOUND", "account was not found");
            if (account.portfolioVersion !== input.expectedPortfolioVersion) {
              throw new PortfolioConsistencyError(
                "VERSION_CONFLICT",
                "portfolio changed since it was read",
              );
            }
            await transaction.updatePosition(input);
            const version = await transaction.incrementPortfolioVersion(
              input.accountId,
              input.expectedPortfolioVersion,
            );
            const positions = await transaction.listPositions(input.accountId);
            return this.snapshot(input.accountId, version, positions);
          },
          { isolationLevel: "serializable" },
        );
        // Invalidate and refresh only after the transaction has committed.
        this.cache.delete(input.accountId);
        this.cache.set(snapshot);
        return snapshot;
      } catch (error) {
        if (!isSerializationConflict(error) || attempt >= 2) throw error;
        attempt += 1;
        await this.sleep(2 ** attempt * 10);
      }
    }
  }

  private snapshot(
    accountId: string,
    version: number,
    positions: PositionRow[],
  ): PortfolioSnapshot {
    return {
      accountId,
      version,
      capturedAt: this.now(),
      positions: positions
        .map((position) => ({ ...position }))
        .sort((left, right) => left.asset.localeCompare(right.asset)),
    };
  }
}
