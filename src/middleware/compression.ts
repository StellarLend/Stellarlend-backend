/**
 * Response compression middleware with configurable size threshold and opt-out.
 *
 * Wraps the `compression` Express middleware with:
 * - Minimum size threshold (1 KiB by default) — tiny responses aren't worth
 *   the CPU cost of compression.
 * - X-No-Compression opt-out header for callers that need the raw body.
 * - Already-encoded responses (Content-Encoding already present) are never
 *   double-compressed.
 *
 * Brotli is typically applied at the reverse-proxy / CDN layer.  When no
 * reverse proxy sits in front, the `compression` package handles gzip and
 * deflate based on the client's Accept-Encoding header — covering all
 * mainstream HTTP clients.
 */
import compression, { type CompressionFilter } from "compression";
import { type Request, type Response } from "express";

const DEFAULT_THRESHOLD = 1024; // 1 KiB
const OPT_OUT_HEADER = "x-no-compression";

export interface CompressionMiddlewareOptions {
  /** Responses smaller than this many bytes are never compressed. @default 1024 */
  threshold?: number;
}

export function compressionMiddleware(
  options: CompressionMiddlewareOptions = {},
): ReturnType<typeof compression> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const filter: CompressionFilter = (req: Request, _res: Response): boolean => {
    if (req.headers[OPT_OUT_HEADER]) {
      return false;
    }
    // `compression` already refuses to double-compress, but be explicit
    return !_res.getHeader("Content-Encoding");
  };

  return compression({ threshold, filter });
}
