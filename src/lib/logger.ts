import { env } from "../config/env.js";
import { getRequestId } from "./requestContext.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|seed|mnemonic)/i;
const SENSITIVE_ASSIGNMENT =
  /\b(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|seed|mnemonic)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(SENSITIVE_ASSIGNMENT, "$1=[REDACTED]");
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (typeof value === "string") {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(child, seen);
    }
    seen.delete(value);
    return redacted;
  }

  return value;
}

export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return redactValue(meta, new WeakSet()) as Record<string, unknown>;
}

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[env.LOG_LEVEL]) {
    return;
  }

  const safeMeta = redactMeta(meta ?? {});
  delete safeMeta.level;
  delete safeMeta.time;
  delete safeMeta.message;

  const requestId = getRequestId();
  const entry = {
    level,
    time: new Date().toISOString(),
    message: redactText(message),
    ...safeMeta,
    ...(requestId ? { requestId } : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
