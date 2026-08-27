/**
 * Minimal structured logger.
 *
 * Emits single-line JSON with request correlation and recursive redaction of
 * credential-like fields. The small dependency metrics registry lives beside
 * this logger so health probes and future ledger clients share one contract.
 */
import { env } from "../config/env.js";
import { getCorrelationId } from "./observability.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) {
    return;
  }

  const entry = {
    level,
    time: new Date().toISOString(),
    ...(getCorrelationId() ? { correlationId: getCorrelationId() } : {}),
    message,
    ...sanitizeMeta(meta),
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|api[_-]?key|private[_-]?key|mnemonic|seed)/i;
function sanitizeMeta(value?: Record<string, unknown>): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : item && typeof item === "object" && !Array.isArray(item)
      ? sanitizeMeta(item as Record<string, unknown>)
      : item,
  ]));
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
