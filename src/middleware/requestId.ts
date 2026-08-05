import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

import { runWithContext } from "../lib/requestContext.js";

/**
 * Header used to carry the correlation identifier. The server echoes this
 * header on every response so clients and downstream services can trace calls.
 */
export const CORRELATION_HEADER = "X-Request-ID";

/**
 * Express middleware that seeds every request with a correlation ID.
 *
 * - If the client sends an `X-Request-ID` header, the value is accepted as-is.
 * - Otherwise a RFC-9562 v4 UUID is generated.
 * - The ID is attached to `AsyncLocalStorage` so any code in the call stack
 *   can retrieve it via `getRequestContext()` / `getRequestId()`.
 * - The ID is echoed back in the response as the `X-Request-ID` header.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers[CORRELATION_HEADER.toLowerCase()] as string | undefined) ?? crypto.randomUUID();
  res.setHeader(CORRELATION_HEADER, id);

  runWithContext(id, () => {
    next();
  });
}
