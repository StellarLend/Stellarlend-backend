/**
 * Wraps an async Express handler so a rejected promise (e.g. a thrown
 * `AppError` or a Prisma error) is forwarded to `next()`. Express 4 does not
 * do this automatically for async handlers — an unhandled rejection would
 * otherwise be silently dropped instead of reaching `errorHandler`.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
