import { describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import {
  createOracleServiceFromEnv,
  HttpJsonPriceSource,
  InvalidPriceObservationError,
  NoTrustedPriceError,
  OracleService,
  type PriceObservation,
  type PriceSource,
} from "../src/services/oracle/index.js";

const INITIAL_NOW = Date.parse("2026-08-03T10:00:00Z");

function observation(
  source: string,
  price: number,
  observedAtMs = INITIAL_NOW - 1_000,
): PriceObservation {
  return {
    asset: "XLM",
    price,
    observedAt: new Date(observedAtMs),
    source,
  };
}

function source(name: string, implementation: PriceSource["getPrice"]): PriceSource {
  return { name, getPrice: vi.fn(implementation) };
}

function service(
  primary: PriceSource,
  options: {
    fallback?: PriceSource;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): OracleService {
  return new OracleService({
    primary,
    fallback: options.fallback,
    stalenessThresholdMs: 60_000,
    cacheTtlMs: 10_000,
    maxDeviationRatio: 0.2,
    requestTimeoutMs: options.timeoutMs ?? 50,
    now: options.now ?? (() => INITIAL_NOW),
  });
}

describe("OracleService", () => {
  it("validates construction and asset-code invariants", async () => {
    const primary = source("primary", async () => observation("primary", 0.12));
    const baseOptions = {
      primary,
      stalenessThresholdMs: 60_000,
      cacheTtlMs: 10_000,
      maxDeviationRatio: 0.2,
      requestTimeoutMs: 50,
    };

    expect(() => new OracleService({ ...baseOptions, cacheTtlMs: 0 })).toThrow(
      "staleness and cache TTL",
    );
    expect(() => new OracleService({ ...baseOptions, maxDeviationRatio: 1.1 })).toThrow(
      "maximum deviation ratio",
    );
    expect(() => new OracleService({ ...baseOptions, requestTimeoutMs: 0 })).toThrow(
      "request timeout",
    );
    await expect(new OracleService(baseOptions).getPrice("not valid!")).rejects.toThrow(
      "Asset codes must contain",
    );
  });

  it("returns a validated primary price and reuses it inside the cache TTL", async () => {
    const primary = source("primary", async () => observation("primary", 0.12));
    const oracle = service(primary);

    const first = await oracle.getPrice("xlm");
    const second = await oracle.getPrice("XLM");

    expect(first).toMatchObject({ asset: "XLM", price: 0.12, cached: false, ageSeconds: 1 });
    expect(second).toMatchObject({ asset: "XLM", price: 0.12, cached: true });
    expect(primary.getPrice).toHaveBeenCalledTimes(1);
  });

  it("uses the fallback when the primary source fails", async () => {
    const primary = source("primary", async () => {
      throw new Error("primary unavailable");
    });
    const fallback = source("fallback", async () => observation("fallback", 0.13));

    await expect(service(primary, { fallback }).getPrice("XLM")).resolves.toMatchObject({
      source: "fallback",
      price: 0.13,
      cached: false,
    });
  });

  it("fails closed when every source fails and no trusted cache exists", async () => {
    const primary = source("primary", async () => {
      throw new Error("primary unavailable");
    });
    const fallback = source("fallback", async () => {
      throw new Error("fallback unavailable");
    });

    const promise = service(primary, { fallback }).getPrice("XLM");
    await expect(promise).rejects.toBeInstanceOf(NoTrustedPriceError);
    await expect(promise).rejects.toMatchObject({
      asset: "XLM",
      failures: [{ source: "primary" }, { source: "fallback" }],
    });
  });

  it("rejects stale observations", async () => {
    const primary = source("primary", async () =>
      observation("primary", 0.12, INITIAL_NOW - 60_001),
    );

    await expect(service(primary).getPrice("XLM")).rejects.toMatchObject({
      failures: [
        {
          source: "primary",
          reason: expect.stringContaining("price is stale"),
        },
      ],
    });
  });

  it("rejects an implausible primary deviation and accepts a sane fallback", async () => {
    let now = INITIAL_NOW;
    let primaryCalls = 0;
    const primary = source("primary", async () => {
      primaryCalls += 1;
      return observation("primary", primaryCalls === 1 ? 100 : 140, now - 1_000);
    });
    const fallback = source("fallback", async () => observation("fallback", 105, now - 1_000));
    const oracle = service(primary, { fallback, now: () => now });

    await expect(oracle.getPrice("XLM")).resolves.toMatchObject({ price: 100 });
    now += 11_000;
    await expect(oracle.getPrice("XLM")).resolves.toMatchObject({
      source: "fallback",
      price: 105,
    });
  });

  it("falls back after a bounded source timeout", async () => {
    const primary = source(
      "primary",
      async () => await new Promise<PriceObservation>(() => undefined),
    );
    const fallback = source("fallback", async () => observation("fallback", 0.13));

    await expect(
      service(primary, { fallback, timeoutMs: 5 }).getPrice("XLM"),
    ).resolves.toMatchObject({ source: "fallback", price: 0.13 });
  });

  it("rechecks freshness at source completion instead of request start", async () => {
    let now = INITIAL_NOW;
    const primary = source("primary", async () => {
      now += 61_000;
      return observation("primary", 0.12, INITIAL_NOW);
    });

    await expect(service(primary, { now: () => now }).getPrice("XLM")).rejects.toMatchObject({
      failures: [{ reason: expect.stringContaining("price is stale") }],
    });
  });

  it("uses an expired-TTL cache only while the underlying observation is still trusted", async () => {
    let now = INITIAL_NOW;
    let fail = false;
    const primary = source("primary", async () => {
      if (fail) {
        throw new Error("temporarily unavailable");
      }
      return observation("primary", 0.12, now - 1_000);
    });
    const oracle = service(primary, { now: () => now });

    await oracle.getPrice("XLM");
    now += 11_000;
    fail = true;

    await expect(oracle.getPrice("XLM")).resolves.toMatchObject({
      source: "primary",
      price: 0.12,
      cached: true,
      ageSeconds: 12,
    });
  });

  it("rejects malformed source observations", async () => {
    const primary = source("primary", async () => ({
      ...observation("primary", 0.12),
      asset: "USDC",
    }));

    try {
      await service(primary).getPrice("XLM");
      throw new Error("expected oracle lookup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NoTrustedPriceError);
      expect((error as NoTrustedPriceError).failures[0]?.reason).toContain(
        new InvalidPriceObservationError("primary", "asset does not match the request").message,
      );
    }
  });

  it.each([
    {
      name: "non-positive price",
      value: { ...observation("primary", 0.12), price: 0 },
      message: "price must be finite and positive",
    },
    {
      name: "invalid timestamp",
      value: { ...observation("primary", 0.12), observedAt: new Date("invalid") },
      message: "timestamp is not valid",
    },
    {
      name: "future timestamp",
      value: observation("primary", 0.12, INITIAL_NOW + 5_001),
      message: "timestamp is in the future",
    },
  ])("fails closed on a $name", async ({ value, message }) => {
    const primary = source("primary", async () => value);

    await expect(service(primary).getPrice("XLM")).rejects.toMatchObject({
      failures: [{ reason: expect.stringContaining(message) }],
    });
  });

  it("does not use a cache after its observation becomes stale", async () => {
    let now = INITIAL_NOW;
    let fail = false;
    const primary = source("primary", async () => {
      if (fail) {
        throw "offline";
      }
      return observation("primary", 0.12, now - 1_000);
    });
    const oracle = service(primary, { now: () => now });

    await oracle.getPrice("XLM");
    now += 61_000;
    fail = true;

    await expect(oracle.getPrice("XLM")).rejects.toMatchObject({
      failures: [{ source: "primary", reason: "offline" }],
    });
  });
});

describe("HttpJsonPriceSource", () => {
  it("requests the encoded asset and parses a strict JSON observation", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ asset: "XLM", price: "0.123", timestamp: "2026-08-03T10:00:00Z" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    const httpSource = new HttpJsonPriceSource(
      "primary",
      "https://oracle.example/prices/{asset}",
      fetchFn,
    );

    const result = await httpSource.getPrice("XLM", { signal: new AbortController().signal });

    expect(fetchFn).toHaveBeenCalledWith(
      new URL("https://oracle.example/prices/XLM"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({ asset: "XLM", price: 0.123, source: "primary" });
  });

  it("adds an asset query parameter and accepts Unix timestamps", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ asset: "XLM", price: 0.123, timestamp: 1_785_750_000 }), {
          status: 200,
        }),
    );
    const httpSource = new HttpJsonPriceSource(
      "primary",
      "https://oracle.example/prices",
      fetchMock as unknown as typeof fetch,
    );

    const result = await httpSource.getPrice("XLM", { signal: new AbortController().signal });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://oracle.example/prices?asset=XLM");
    expect(result.observedAt.getTime()).toBe(1_785_750_000_000);
  });

  it("rejects non-success HTTP responses", async () => {
    const fetchFn = vi.fn(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;
    const httpSource = new HttpJsonPriceSource("primary", "https://oracle.example/prices", fetchFn);

    await expect(
      httpSource.getPrice("XLM", { signal: new AbortController().signal }),
    ).rejects.toThrow("HTTP 503");
  });
});

describe("createOracleServiceFromEnv", () => {
  it("requires a configured primary URL", () => {
    const original = env.ORACLE_PRIMARY_URL;
    delete env.ORACLE_PRIMARY_URL;
    try {
      expect(() => createOracleServiceFromEnv()).toThrow("ORACLE_PRIMARY_URL is required");
    } finally {
      env.ORACLE_PRIMARY_URL = original;
    }
  });

  it("builds configured primary and fallback sources", () => {
    const original = {
      primaryUrl: env.ORACLE_PRIMARY_URL,
      fallbackUrl: env.ORACLE_FALLBACK_URL,
      fallbackSource: env.ORACLE_FALLBACK_SOURCE,
    };
    env.ORACLE_PRIMARY_URL = "https://oracle.example/prices/{asset}";
    env.ORACLE_FALLBACK_URL = "https://fallback.example/prices/{asset}";
    env.ORACLE_FALLBACK_SOURCE = "independent-backup";

    try {
      expect(createOracleServiceFromEnv()).toBeInstanceOf(OracleService);
    } finally {
      env.ORACLE_PRIMARY_URL = original.primaryUrl;
      env.ORACLE_FALLBACK_URL = original.fallbackUrl;
      env.ORACLE_FALLBACK_SOURCE = original.fallbackSource;
    }
  });
});
