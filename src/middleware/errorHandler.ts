/**
 * Centralized error handling: a typed base error class plus an Express error
 * middleware that maps it (or any thrown error) to a consistent JSON error
 * envelope. Route handlers should `throw new AppError(...)` (or a subclass)
 * instead of building error responses inline.
 */
import type { NextFunction, Request, Response } from "express";

import { logger } from "../lib/logger.js";
import { captureServerError } from "../lib/telemetry/sentry.js";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `No route for ${req.method} ${req.originalUrl}`,
    },
  });
}

// Express only recognizes an error-handling middleware if it declares all
// four parameters, so `_req` and `_next` must stay even though unused.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  logger.error("unhandled error", {
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  captureServerError(err, {
    method: req.method,
    requestId: req.get("x-request-id"),
    route: req.route?.path ?? req.path,
  });

  res.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
  });
}
