/**
 * Request body size limits and Content-Type enforcement middleware.
 *
 * Rejects oversized requests with 413 before body parsing, and rejects
 * non-JSON Content-Type on mutating endpoints (POST/PUT/PATCH) with 415.
 *
 * Limits are configurable via env (BODY_SIZE_LIMIT default "100kb",
 * CONTENT_TYPE_ENFORCEMENT default true). Per-route overrides available
 * through the factory function.
 *
 * @module bodyLimits
 */

import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

function parseSize(size: string): number {
  const match = size.toLowerCase().trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/);
  if (!match) {
    throw new Error(
      `Invalid size format: "${size}". Expected a value like "100kb", "1mb", or "500b".`,
    );
  }
  return Math.round(parseFloat(match[1]!) * SIZE_UNITS[match[2]!]!);
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BodyLimitsOptions {
  /** Maximum request body size (env-parseable string, e.g. "100kb", "2mb"). Overrides env.BODY_SIZE_LIMIT. */
  maxSize?: string;
  /** Whether to enforce JSON Content-Type on mutating endpoints. Default: env.CONTENT_TYPE_ENFORCEMENT. */
  enforceContentType?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Maximum body size in bytes for this request, set by the body-limits middleware. */
      bodySizeLimit?: number;
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that enforces request-body size and
 * Content-Type constraints.
 *
 * Call with per-route overrides (e.g. {@link bodyLimits `bodyLimits({ maxSize: "5mb" })`}) or
 * without arguments to use env defaults ({@link env.BODY_SIZE_LIMIT `BODY_SIZE_LIMIT`} /
 * {@link env.CONTENT_TYPE_ENFORCEMENT `CONTENT_TYPE_ENFORCEMENT`}).
 *
 * @param opts - Optional per-route overrides.
 * @returns Express middleware function.
 *
 * @example
 * // Global default (applies to all routes):
 * app.use(bodyLimits());
 *
 * @example
 * // Per-route override for a bulk-import endpoint:
 * router.post("/import", bodyLimits({ maxSize: "10mb" }), importHandler);
 */
export function bodyLimits(opts?: BodyLimitsOptions) {
  const maxSizeStr = opts?.maxSize ?? env.BODY_SIZE_LIMIT;
  const enforceCt = opts?.enforceContentType ?? env.CONTENT_TYPE_ENFORCEMENT;
  const maxBytes = parseSize(maxSizeStr);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Expose the effective limit so downstream code can read it.
    req.bodySizeLimit = maxBytes;

    // --- Content-Type enforcement (mutating endpoints only) ---
    if (enforceCt && MUTATING_METHODS.has(req.method.toUpperCase())) {
      const ct = (req.headers["content-type"] ?? "").toLowerCase();
      if (!ct.includes("application/json")) {
        res.status(415).json({
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message:
              `Content-Type must be application/json for ${req.method} requests, ` +
              `got "${req.headers["content-type"] ?? "none"}".`,
          },
        });
        return;
      }
    }

    // --- Body size check via Content-Length header ---
    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (isNaN(size) || size < 0) {
        res.status(400).json({
          error: {
            code: "BAD_REQUEST",
            message: "Invalid Content-Length header.",
          },
        });
        return;
      }
      if (size > maxBytes) {
        res.status(413).json({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message:
              `Request body exceeds the maximum size of ${maxSizeStr} ` +
              `(${size} bytes received).`,
          },
        });
        return;
      }
    }

    next();
  };
}
