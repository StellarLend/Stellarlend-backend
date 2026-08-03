import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { runWithRequestContext } from "../lib/requestContext.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const suppliedRequestId = req.header("x-request-id");
  const requestId =
    suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId) ? suppliedRequestId : randomUUID();

  res.setHeader("x-request-id", requestId);
  runWithRequestContext({ requestId }, next);
}
