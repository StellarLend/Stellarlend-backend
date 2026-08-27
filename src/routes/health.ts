/**
 * Liveness/readiness endpoints.
 *
 * `/health` is a cheap liveness check (process is up, event loop is running).
 * `/ready` additionally checks the database connection and should be used by
 * orchestrators/load balancers to decide whether to route traffic here.
 */
import { Router, type Request, type Response } from "express";

import { prisma } from "../lib/prisma.js";
import { recordDependency, renderObservabilityMetrics } from "../lib/observability.js";

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/ready", async (_req: Request, res: Response) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    recordDependency("prisma", "success", Date.now() - startedAt);
    res.status(200).json({ status: "ready" });
  } catch {
    recordDependency("prisma", "error", Date.now() - startedAt);
    res.status(503).json({
      status: "not_ready",
      reason: "database unavailable",
    });
  }
});

healthRouter.get("/metrics", (_req: Request, res: Response) => {
  res.type("text/plain").send(renderObservabilityMetrics());
});
