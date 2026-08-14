import request from "supertest";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureServerError,
  resetSentryClientForTesting,
  scrubSentryEvent,
  setSentryClientForTesting,
} from "../src/lib/telemetry/sentry.js";
import { AppError, errorHandler } from "../src/middleware/errorHandler.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetSentryClientForTesting();
});

describe("scrubSentryEvent", () => {
  it("redacts sensitive fields and PII inside messages", () => {
    const event = scrubSentryEvent({
      message:
        "Failed for alberto@example.com at wallet 0x1234567890abcdef1234567890abcdef12345678",
      request: {
        headers: {
          authorization: "Bearer secret-token",
          "x-request-id": "req_123",
        },
      },
      extra: {
        contactEmail: "ops@example.com",
        safeRoute: "/health",
      },
    });

    expect(event.message).toBe(`Failed for [REDACTED] at wallet [REDACTED]`);
    expect(event.request?.headers).toMatchObject({
      authorization: "[REDACTED]",
      "x-request-id": "req_123",
    });
    expect(event.extra).toMatchObject({
      contactEmail: "[REDACTED]",
      safeRoute: "/health",
    });
  });
});

describe("captureServerError", () => {
  it("does nothing when SENTRY_DSN is not configured", () => {
    vi.stubEnv("SENTRY_DSN", "");
    const captureException = vi.fn();
    setSentryClientForTesting({ captureException, init: vi.fn() });

    captureServerError(new Error("boom"), { method: "GET", route: "/health" });

    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not throw when the Sentry client fails", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    setSentryClientForTesting({
      captureException: vi.fn(() => {
        throw new Error("sentry unavailable");
      }),
      init: vi.fn(),
    });

    expect(() =>
      captureServerError(new Error("boom"), { method: "POST", requestId: "req_1" }),
    ).not.toThrow();
  });
});

describe("errorHandler Sentry capture", () => {
  it("returns the original 500 response even if Sentry capture fails", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    setSentryClientForTesting({
      captureException: vi.fn(() => {
        throw new Error("sentry unavailable");
      }),
      init: vi.fn(),
    });

    const app = express();
    app.get("/explode", () => {
      throw new Error("alberto@example.com failed with token abc");
    });
    app.use(errorHandler);

    const response = await request(app).get("/explode").set("x-request-id", "req_123");

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("does not send AppError validation responses to Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.com/1");
    const captureException = vi.fn();
    setSentryClientForTesting({ captureException, init: vi.fn() });

    const app = express();
    app.get("/bad-input", () => {
      throw new AppError("BAD_INPUT", "bad request");
    });
    app.use(errorHandler);

    return request(app)
      .get("/bad-input")
      .expect(400)
      .then(() => {
        expect(captureException).not.toHaveBeenCalled();
      });
  });
});
