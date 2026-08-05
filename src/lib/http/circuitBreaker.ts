/**
 * Generic per-host circuit breaker for outbound HTTP calls.
 *
 * Tracks success/failure per host and automatically transitions between
 * CLOSED -> OPEN -> HALF_OPEN -> CLOSED based on configurable thresholds.
 * All callers (Horizon, Soroban RPC, price oracle, webhooks) share the
 * same state so a degraded downstream is not hammered by every caller
 * while it recovers.
 */
import { logger } from "../logger.js";

/** Circuit state machine. */
export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

/** Per-host state tracked by the circuit breaker. */
export interface HostState {
  /** Current circuit state. */
  state: CircuitState;
  /** Consecutive failures since last success. */
  failureCount: number;
  /** Total calls tracked in the current window. */
  totalCount: number;
  /** ISO timestamp when the circuit was opened (null when not open). */
  openedAt: string | null;
}

/** Configuration for the circuit breaker. */
export interface CircuitBreakerOptions {
  /**
   * Fraction of failures (0-1) that triggers the circuit to open.
   * @default 0.5
   */
  failureThreshold: number;
  /**
   * Minimum number of calls that must be recorded before the failure
   * threshold is evaluated (guards against premature tripping on
   * tiny samples).
   * @default 5
   */
  minSampleSize: number;
  /**
   * Milliseconds the circuit stays open before transitioning to
   * half-open to probe the downstream.
   * @default 30_000 (30 seconds)
   */
  cooldownMs: number;
  /**
   * Maximum number of consecutive failures before the circuit opens
   * regardless of the ratio threshold.
   * @default 20
   */
  maxConsecutiveFailures: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 0.5,
  minSampleSize: 5,
  cooldownMs: 30_000,
  maxConsecutiveFailures: 20,
};

/** Snapshot of per-host metrics exposed for dashboard gauges. */
export interface CircuitBreakerMetrics {
  host: string;
  state: CircuitState;
  failureCount: number;
  totalCount: number;
  openedAt: string | null;
}

export class CircuitBreaker {
  private readonly hosts = new Map<string, HostState>();
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // ---- public API -------------------------------------------------

  /**
   * Returns true if a caller should attempt a request to `host`.
   *
   * - CLOSED -> always allow.
   * - HALF_OPEN -> allow exactly one probe call (the first caller that
   *   asks after cooldown). Subsequent callers see OPEN until the probe
   *   result is recorded.
   * - OPEN -> allow only if the cooldown has elapsed (transition to
   *   HALF_OPEN), otherwise deny.
   */
  shouldAllow(host: string): boolean {
    const h = this.getOrCreate(host);

    if (h.state === CircuitState.CLOSED) {
      return true;
    }

    if (h.state === CircuitState.OPEN) {
      const elapsed = Date.now() - new Date(h.openedAt!).getTime();
      if (elapsed >= this.options.cooldownMs) {
        h.state = CircuitState.HALF_OPEN;
        logger.info("Circuit half-open (probing downstream)", {
          host,
          elapsedMs: elapsed,
        });
        return true; // first probe
      }
      return false;
    }

    // HALF_OPEN: only one probe at a time
    return false;
  }

  /** Record a successful call. */
  recordSuccess(host: string): void {
    const h = this.getOrCreate(host);

    if (h.state === CircuitState.HALF_OPEN) {
      logger.info("Circuit closed after successful half-open probe", { host });
    }

    h.state = CircuitState.CLOSED;
    h.failureCount = 0;
    h.totalCount += 1;
    h.openedAt = null;
  }

  /** Record a failed call. */
  recordFailure(host: string): void {
    const h = this.getOrCreate(host);

    h.failureCount += 1;
    h.totalCount += 1;

    const shouldOpen =
      h.failureCount >= this.options.maxConsecutiveFailures ||
      (h.totalCount >= this.options.minSampleSize &&
        h.failureCount / h.totalCount >= this.options.failureThreshold);

    if (shouldOpen && h.state !== CircuitState.OPEN) {
      const wasHalfOpen = h.state === CircuitState.HALF_OPEN;
      h.state = CircuitState.OPEN;
      h.openedAt = new Date().toISOString();
      logger.warn("Circuit opened", {
        host,
        failureCount: h.failureCount,
        totalCount: h.totalCount,
        failureRate: (h.failureCount / h.totalCount).toFixed(3),
      });

      if (wasHalfOpen) {
        // Re-opened after a failed probe -- reset counters for the next
        // cooldown cycle so a single stale probe doesn't make the
        // failure rate unreachable.
        h.failureCount = 0;
        h.totalCount = 0;
      }
    }
  }

  /**
   * Return a snapshot of per-host metrics for dashboard gauges.
   */
  getMetrics(): CircuitBreakerMetrics[] {
    const result: CircuitBreakerMetrics[] = [];
    for (const [host, h] of this.hosts) {
      result.push({
        host,
        state: h.state,
        failureCount: h.failureCount,
        totalCount: h.totalCount,
        openedAt: h.openedAt,
      });
    }
    return result;
  }

  /**
   * Return the current state for a specific host (useful for health-check
   * endpoints).
   */
  getHostState(host: string): HostState {
    return this.getOrCreate(host);
  }

  // ---- internal ---------------------------------------------------

  private getOrCreate(host: string): HostState {
    let h = this.hosts.get(host);
    if (!h) {
      h = {
        state: CircuitState.CLOSED,
        failureCount: 0,
        totalCount: 0,
        openedAt: null,
      };
      this.hosts.set(host, h);
    }
    return h;
  }
}

/** Singleton shared across all outbound callers. */
export const circuitBreaker = new CircuitBreaker();
