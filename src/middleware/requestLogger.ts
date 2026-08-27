/**
 * Request logging middleware: one structured, redacted log line per request.
 */
import type { NextFunction, Request, Response } from "express";

import { logger } from "../lib/logger.js";
import { createCorrelationId, runWithCorrelationId } from "../lib/observability.js";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const correlationId = createCorrelationId(req.header("x-correlation-id") ?? req.header("x-request-id"));
  res.setHeader("x-correlation-id", correlationId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info("request completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      correlationId,
    });
  });

  runWithCorrelationId(correlationId, next);
}
