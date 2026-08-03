import type { NextFunction, Request, Response } from "express";

import { logger } from "../lib/logger.js";
import { httpRequestDurationSeconds } from "../observability/metrics.js";

function normalizeMetricPath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return ":id";
      }
      if (/^[0-9a-f]{24,}$/i.test(segment)) {
        return ":id";
      }
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) {
        return ":id";
      }
      return segment;
    })
    .join("/");
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const requestPath = req.path;
  const metricPath = normalizeMetricPath(requestPath);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    httpRequestDurationSeconds.observe(
      {
        method: req.method,
        route: res.statusCode === 404 ? "unmatched" : metricPath,
        status_code: String(res.statusCode),
      },
      durationMs / 1_000,
    );
    logger.info("request completed", {
      method: req.method,
      path: requestPath,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    });
  });

  next();
}
