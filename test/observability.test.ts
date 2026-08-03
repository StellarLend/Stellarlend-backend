import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { logger } from "../src/lib/logger.js";
import { requestContext } from "../src/middleware/requestContext.js";
import { requestLogger } from "../src/middleware/requestLogger.js";
import {
  metricsRegistry,
  recordTransactionSubmission,
  resetMetrics,
  setIndexerLag,
} from "../src/observability/metrics.js";
import { createMetricsRouter } from "../src/routes/metrics.js";

beforeEach(() => {
  resetMetrics();
  vi.restoreAllMocks();
});

describe("request observability", () => {
  it("preserves a safe caller request ID and includes it in structured logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await request(createApp())
      .get("/health")
      .set("x-request-id", "client-request-123");

    expect(response.headers["x-request-id"]).toBe("client-request-123");
    const entry = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(entry).toMatchObject({
      message: "request completed",
      requestId: "client-request-123",
      path: "/health",
    });
  });

  it("replaces an unsafe caller request ID", async () => {
    const response = await request(createApp())
      .get("/health")
      .set("x-request-id", "contains spaces");

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers["x-request-id"]).not.toBe("contains spaces");
  });

  it("redacts nested secrets and serializes errors", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("safe event", {
      authorization: "Bearer secret",
      nested: { apiKey: "private", value: 42 },
      error: new Error("boom"),
    });

    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry.authorization).toBe("[REDACTED]");
    expect(entry.nested).toEqual({ apiKey: "[REDACTED]", value: 42 });
    expect(entry.error).toMatchObject({ name: "Error", message: "boom" });
  });

  it("redacts common secret patterns embedded in messages and values", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("request failed with Bearer exposed-token", {
      detail: "token=abc123 at https://operator:password@example.com",
      error: new Error("JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature was rejected"),
    });

    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry.message).toBe("request failed with Bearer [REDACTED]");
    expect(entry.detail).not.toContain("abc123");
    expect(entry.detail).not.toContain("password@example.com");
    expect(entry.error.message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("handles arrays, circular metadata, suppressed levels, and stderr levels", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    logger.debug("suppressed");
    logger.warn("warning", {
      items: [{ password: "private" }],
      circular,
      level: "forged",
      message: "forged",
    });
    logger.error("failure");

    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(2);
    const warning = JSON.parse(String(errors.mock.calls[0]?.[0]));
    expect(warning).toMatchObject({ level: "warn", message: "warning" });
    expect(warning.items).toEqual([{ password: "[REDACTED]" }]);
    expect(warning.circular).toEqual({ self: "[Circular]" });
  });

  it("exports normalized HTTP metrics", async () => {
    const app = createApp();
    await request(app).get("/health");

    const response = await request(app).get("/metrics");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("stellarlend_http_request_duration_seconds_count");
    expect(response.text).toContain('route="/health"');
  });

  it("normalizes dynamic path segments before using them as metric labels", async () => {
    const app = express();
    app.use(requestContext);
    app.use(requestLogger);
    app.get("/items/:id", (_req, res) => res.json({ ok: true }));

    await request(app).get("/items/123");
    await request(app).get(`/items/${"a".repeat(64)}`);
    await request(app).get("/items/123e4567-e89b-12d3-a456-426614174000");

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain('route="/items/:id"');
    expect(metrics).not.toContain("123e4567-e89b-12d3-a456-426614174000");
  });

  it("records transaction outcomes and clamps negative indexer lag", async () => {
    recordTransactionSubmission("testnet", "success");
    setIndexerLag("testnet", -5);

    const metrics = await metricsRegistry.metrics();
    expect(metrics).toContain(
      'stellarlend_transaction_submissions_total{network="testnet",outcome="success"} 1',
    );
    expect(metrics).toContain('stellarlend_indexer_lag_seconds{network="testnet"} 0');
  });
});

describe("metrics authentication", () => {
  it("requires the configured bearer token", async () => {
    const app = express();
    app.use(createMetricsRouter("sixteen-char-token"));

    const unauthorized = await request(app).get("/metrics");
    const authorized = await request(app)
      .get("/metrics")
      .set("authorization", "Bearer sixteen-char-token");

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
  });
});
