import { performance } from "node:perf_hooks";

import { z } from "zod";

import { env } from "../../config/env.js";
import {
  oraclePriceAgeSeconds,
  oracleRequestDurationSeconds,
  oracleRequestsTotal,
} from "../../observability/metrics.js";

export interface PriceObservation {
  asset: string;
  price: number;
  observedAt: Date;
  source: string;
}

export interface TrustedPrice extends PriceObservation {
  ageSeconds: number;
  cached: boolean;
}

export interface PriceSource {
  readonly name: string;
  getPrice(asset: string, options: { signal: AbortSignal }): Promise<PriceObservation>;
}

interface CachedPrice {
  observation: PriceObservation;
  cachedAtMs: number;
}

export interface OracleServiceOptions {
  primary: PriceSource;
  fallback?: PriceSource;
  stalenessThresholdMs: number;
  cacheTtlMs: number;
  maxDeviationRatio: number;
  requestTimeoutMs: number;
  now?: () => number;
}

interface SourceFailure {
  source: string;
  reason: string;
}

export class NoTrustedPriceError extends Error {
  readonly asset: string;
  readonly failures: SourceFailure[];

  constructor(asset: string, failures: SourceFailure[]) {
    super(`No trusted price is available for ${asset}.`);
    this.name = "NoTrustedPriceError";
    this.asset = asset;
    this.failures = failures;
  }
}

export class OracleSourceTimeoutError extends Error {
  constructor(source: string, timeoutMs: number) {
    super(`Oracle source ${source} exceeded the ${timeoutMs}ms timeout.`);
    this.name = "OracleSourceTimeoutError";
  }
}

export class InvalidPriceObservationError extends Error {
  constructor(source: string, reason: string) {
    super(`Oracle source ${source} returned an invalid price: ${reason}.`);
    this.name = "InvalidPriceObservationError";
  }
}

function normalizeAsset(asset: string): string {
  const normalized = asset.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,32}$/.test(normalized)) {
    throw new Error(
      "Asset codes must contain 1-32 letters, numbers, dots, underscores, or dashes.",
    );
  }
  return normalized;
}

function sourceOutcome(error: unknown): string {
  if (error instanceof OracleSourceTimeoutError) {
    return "timeout";
  }
  if (error instanceof InvalidPriceObservationError) {
    return "invalid";
  }
  return "error";
}

export class OracleService {
  private readonly cache = new Map<string, CachedPrice>();
  private readonly now: () => number;

  constructor(private readonly options: OracleServiceOptions) {
    if (options.stalenessThresholdMs <= 0 || options.cacheTtlMs <= 0) {
      throw new Error("Oracle staleness and cache TTL values must be positive.");
    }
    if (options.maxDeviationRatio <= 0 || options.maxDeviationRatio > 1) {
      throw new Error("Oracle maximum deviation ratio must be greater than 0 and at most 1.");
    }
    if (options.requestTimeoutMs <= 0) {
      throw new Error("Oracle request timeout must be positive.");
    }

    this.now = options.now ?? Date.now;
  }

  async getPrice(asset: string): Promise<TrustedPrice> {
    const normalizedAsset = normalizeAsset(asset);
    const nowMs = this.now();
    const cached = this.cache.get(normalizedAsset);

    if (
      cached &&
      nowMs - cached.cachedAtMs <= this.options.cacheTtlMs &&
      this.ageMs(cached.observation, nowMs) <= this.options.stalenessThresholdMs
    ) {
      oracleRequestsTotal.inc({ source: "cache", outcome: "hit" });
      return this.toTrustedPrice(cached.observation, nowMs, true);
    }

    const failures: SourceFailure[] = [];
    const sources = [this.options.primary, this.options.fallback].filter(
      (source): source is PriceSource => Boolean(source),
    );

    for (const source of sources) {
      const startedAt = performance.now();
      let outcome = "success";
      try {
        const result = await this.fetchWithTimeout(source, normalizedAsset);
        const validationNowMs = this.now();
        const observation = { ...result, source: source.name };
        this.validateObservation(
          observation,
          normalizedAsset,
          validationNowMs,
          cached?.observation,
        );
        this.cache.set(normalizedAsset, { observation, cachedAtMs: validationNowMs });
        oracleRequestsTotal.inc({ source: source.name, outcome });
        return this.toTrustedPrice(observation, validationNowMs, false);
      } catch (error) {
        outcome = sourceOutcome(error);
        oracleRequestsTotal.inc({ source: source.name, outcome });
        failures.push({
          source: source.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        oracleRequestDurationSeconds.observe(
          { source: source.name, outcome },
          (performance.now() - startedAt) / 1_000,
        );
      }
    }

    const fallbackNowMs = this.now();
    if (
      cached &&
      this.ageMs(cached.observation, fallbackNowMs) <= this.options.stalenessThresholdMs
    ) {
      oracleRequestsTotal.inc({ source: "cache", outcome: "fallback" });
      return this.toTrustedPrice(cached.observation, fallbackNowMs, true);
    }

    oracleRequestsTotal.inc({ source: "cache", outcome: "miss" });
    throw new NoTrustedPriceError(normalizedAsset, failures);
  }

  private async fetchWithTimeout(source: PriceSource, asset: string): Promise<PriceObservation> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new OracleSourceTimeoutError(source.name, this.options.requestTimeoutMs));
      }, this.options.requestTimeoutMs);
    });

    try {
      return await Promise.race([
        source.getPrice(asset, { signal: controller.signal }),
        timeoutPromise,
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private validateObservation(
    observation: PriceObservation,
    requestedAsset: string,
    nowMs: number,
    reference?: PriceObservation,
  ): void {
    if (normalizeAsset(observation.asset) !== requestedAsset) {
      throw new InvalidPriceObservationError(
        observation.source,
        "asset does not match the request",
      );
    }
    if (!Number.isFinite(observation.price) || observation.price <= 0) {
      throw new InvalidPriceObservationError(
        observation.source,
        "price must be finite and positive",
      );
    }
    if (!Number.isFinite(observation.observedAt.getTime())) {
      throw new InvalidPriceObservationError(observation.source, "timestamp is not valid");
    }

    const ageMs = this.ageMs(observation, nowMs);
    if (observation.observedAt.getTime() > nowMs + 5_000) {
      throw new InvalidPriceObservationError(observation.source, "timestamp is in the future");
    }
    if (ageMs > this.options.stalenessThresholdMs) {
      throw new InvalidPriceObservationError(observation.source, "price is stale");
    }

    if (reference && this.ageMs(reference, nowMs) <= this.options.stalenessThresholdMs) {
      const deviation = Math.abs(observation.price - reference.price) / reference.price;
      if (deviation > this.options.maxDeviationRatio) {
        throw new InvalidPriceObservationError(
          observation.source,
          `deviation ${(deviation * 100).toFixed(2)}% exceeds the configured limit`,
        );
      }
    }
  }

  private ageMs(observation: PriceObservation, nowMs: number): number {
    return Math.max(0, nowMs - observation.observedAt.getTime());
  }

  private toTrustedPrice(
    observation: PriceObservation,
    nowMs: number,
    cached: boolean,
  ): TrustedPrice {
    const ageSeconds = this.ageMs(observation, nowMs) / 1_000;
    oraclePriceAgeSeconds.set({ asset: observation.asset, source: observation.source }, ageSeconds);
    return { ...observation, ageSeconds, cached };
  }
}

const httpPriceSchema = z.object({
  asset: z.string().min(1),
  price: z.coerce.number().positive(),
  timestamp: z.union([z.string().min(1), z.number()]),
});

export class HttpJsonPriceSource implements PriceSource {
  constructor(
    readonly name: string,
    private readonly endpoint: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getPrice(asset: string, options: { signal: AbortSignal }): Promise<PriceObservation> {
    const encodedAsset = encodeURIComponent(asset);
    const hasAssetPlaceholder = this.endpoint.includes("{asset}");
    const url = new URL(this.endpoint.replace("{asset}", encodedAsset));
    if (!hasAssetPlaceholder) {
      url.searchParams.set("asset", asset);
    }

    const response = await this.fetchFn(url, {
      headers: { accept: "application/json" },
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`Oracle source ${this.name} returned HTTP ${response.status}.`);
    }

    const payload = httpPriceSchema.parse(await response.json());
    const timestamp =
      typeof payload.timestamp === "number"
        ? new Date(
            payload.timestamp < 10_000_000_000 ? payload.timestamp * 1_000 : payload.timestamp,
          )
        : new Date(payload.timestamp);

    return {
      asset: payload.asset,
      price: payload.price,
      observedAt: timestamp,
      source: this.name,
    };
  }
}

export function createOracleServiceFromEnv(): OracleService {
  if (!env.ORACLE_PRIMARY_URL) {
    throw new Error("ORACLE_PRIMARY_URL is required before the oracle service can be used.");
  }

  const primary = new HttpJsonPriceSource(env.ORACLE_PRIMARY_SOURCE, env.ORACLE_PRIMARY_URL);
  const fallback = env.ORACLE_FALLBACK_URL
    ? new HttpJsonPriceSource(env.ORACLE_FALLBACK_SOURCE ?? "fallback", env.ORACLE_FALLBACK_URL)
    : undefined;

  return new OracleService({
    primary,
    fallback,
    stalenessThresholdMs: env.ORACLE_PRICE_STALENESS_THRESHOLD_SECONDS * 1_000,
    cacheTtlMs: env.ORACLE_CACHE_TTL_SECONDS * 1_000,
    maxDeviationRatio: env.ORACLE_MAX_DEVIATION_PERCENT / 100,
    requestTimeoutMs: env.ORACLE_REQUEST_TIMEOUT_MS,
  });
}
