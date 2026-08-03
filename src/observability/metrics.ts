import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const metricsRegistry = new Registry();

export const httpRequestDurationSeconds = new Histogram({
  name: "stellarlend_http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

export const oracleRequestDurationSeconds = new Histogram({
  name: "stellarlend_oracle_request_duration_seconds",
  help: "Oracle source request duration in seconds.",
  labelNames: ["source", "outcome"] as const,
  registers: [metricsRegistry],
});

export const oracleRequestsTotal = new Counter({
  name: "stellarlend_oracle_requests_total",
  help: "Oracle source and cache outcomes.",
  labelNames: ["source", "outcome"] as const,
  registers: [metricsRegistry],
});

export const oraclePriceAgeSeconds = new Gauge({
  name: "stellarlend_oracle_price_age_seconds",
  help: "Age of the last trusted oracle price in seconds.",
  labelNames: ["asset", "source"] as const,
  registers: [metricsRegistry],
});

export const transactionSubmissionsTotal = new Counter({
  name: "stellarlend_transaction_submissions_total",
  help: "Stellar transaction submission outcomes.",
  labelNames: ["network", "outcome"] as const,
  registers: [metricsRegistry],
});

export const indexerLagSeconds = new Gauge({
  name: "stellarlend_indexer_lag_seconds",
  help: "Indexer lag behind the latest observed ledger in seconds.",
  labelNames: ["network"] as const,
  registers: [metricsRegistry],
});

export function recordTransactionSubmission(network: string, outcome: string): void {
  transactionSubmissionsTotal.inc({ network, outcome });
}

export function setIndexerLag(network: string, lagSeconds: number): void {
  indexerLagSeconds.set({ network }, Math.max(0, lagSeconds));
}

export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}
