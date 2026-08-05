import type { NextFunction, Request, Response } from "express";

import { getRequestId } from "../lib/requestContext.js";
import { logger } from "../lib/logger.js";

/**
 * Minimal request-logging middleware: one structured log line per request
 * with method, path, status code, duration, and the correlation request ID.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info("request completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      requestId: getRequestId(),
    });
  });

  next();
}
