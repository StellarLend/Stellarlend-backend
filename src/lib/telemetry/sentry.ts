/**
 * Optional Sentry integration for server-side errors.
 *
 * The integration stays inert unless SENTRY_DSN is configured, which keeps
 * local development and CI from sending events to an external service.
 */
import * as Sentry from "@sentry/node";

import { env } from "../../config/env.js";
import { logger } from "../logger.js";

const REDACTED = "[REDACTED]";
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ETH_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/g;
const STELLAR_ADDRESS_PATTERN = /\bG[A-Z2-7]{55}\b/g;
const SOLANA_ADDRESS_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|email|password|secret|token|wallet/i;

type ErrorContext = {
  method?: string;
  requestId?: string;
  route?: string;
};

type SentryClient = Pick<typeof Sentry, "captureException" | "init">;

let client: SentryClient = Sentry;

export function setSentryClientForTesting(testClient: SentryClient): void {
  client = testClient;
}

export function resetSentryClientForTesting(): void {
  client = Sentry;
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN ?? env.SENTRY_DSN;
  if (!dsn) {
    logger.debug("sentry disabled: SENTRY_DSN is not configured");
    return;
  }

  client.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    beforeSend: (event) => scrubSentryEvent(event) as Sentry.ErrorEvent,
  });
}

export function captureServerError(error: unknown, context: ErrorContext): void {
  const dsn = process.env.SENTRY_DSN ?? env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  try {
    client.captureException(error, {
      tags: {
        method: context.method,
        route: context.route,
      },
      extra: {
        requestId: context.requestId,
      },
    });
  } catch (captureError) {
    logger.warn("sentry capture failed", {
      errorMessage: captureError instanceof Error ? captureError.message : String(captureError),
    });
  }
}

export function scrubSentryEvent(event: Sentry.Event): Sentry.Event {
  return scrubValue(event) as Sentry.Event;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrubValue(entry),
    ]),
  );
}

function scrubText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(ETH_ADDRESS_PATTERN, REDACTED)
    .replace(STELLAR_ADDRESS_PATTERN, REDACTED)
    .replace(SOLANA_ADDRESS_PATTERN, REDACTED);
}
