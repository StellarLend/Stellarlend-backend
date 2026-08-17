/**
 * Interim caller-identity middleware.
 *
 * Real session auth (SEP-10 challenge/verify + JWT — see `src/routes/auth.ts`,
 * currently a `501` placeholder) isn't implemented yet. Until it lands,
 * routes that need to scope data to "the caller" read the user id from the
 * `X-User-Id` header instead of a verified session. This is a single,
 * documented call site to swap for `req.userId = session.userId` once real
 * auth exists — callers of protected routes should not otherwise assume this
 * header is trusted or persists.
 */
import type { NextFunction, Request, Response } from "express";

import { AppError } from "./errorHandler.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

export function requireUserId(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("x-user-id");

  if (!header || header.trim() === "") {
    throw new AppError("UNAUTHORIZED", "Missing X-User-Id header.", 401);
  }

  req.userId = header;
  next();
}
