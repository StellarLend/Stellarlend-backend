/**
 * Deprecation middleware: marks specific API version routes as deprecated
 * by adding standard {@link https://datatracker.ietf.org/doc/html/rfc8594 Deprecation}
 * and {@link https://datatracker.ietf.org/doc/html/rfc8594 Sunset} response headers.
 *
 * Deprecated routes continue to function normally — the headers are purely
 * informational, giving client teams advance notice before the version is removed
 * in a later release.
 *
 * @example
 * ```ts
 * import { deprecation } from "./middleware/deprecation.js";
 *
 * // Mark all /api/v1 routes as deprecated, sunsetting 2026-03-01
 * app.use("/api/v1", deprecation({ sunset: "2026-03-01" }));
 * ```
 */
import type { RequestHandler } from "express";

export interface DeprecationOptions {
  /** ISO 8601 date string (e.g. "2026-03-01") after which the endpoint may be removed. */
  sunset: string;
  /** Optional URL pointing to migration docs or the replacement version. */
  link?: string;
}

/**
 * Returns an Express middleware that adds {@code Deprecation} and {@code Sunset}
 * headers to every response passing through it.
 *
 * Apply this middleware at the router level for a specific API version prefix
 * (e.g. {@code app.use("/api/v1", deprecation({ sunset: "2026-03-01" }))}) so
 * only that version's routes carry the headers.
 */
export function deprecation(opts: DeprecationOptions): RequestHandler {
  // Validate the sunset date string once at factory-creation time.
  const sunsetTimestamp = Date.parse(opts.sunset);
  if (Number.isNaN(sunsetTimestamp)) {
    throw new TypeError(
      `deprecation middleware: sunset must be a valid ISO 8601 date, got "${opts.sunset}"`,
    );
  }

  // Pre-compute the HTTP-date (RFC 7231 IMF-fixdate) string so we don't
  // re-format on every request.
  const sunsetHttpDate = new Date(sunsetTimestamp).toUTCString();

  return (_req, res, next) => {
    // Informational-only header per RFC 8594 § 4.
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", sunsetHttpDate);

    if (opts.link !== undefined) {
      res.setHeader("Link", `<${opts.link}>; rel="deprecation"`);
    }

    next();
  };
}
