import { timingSafeEqual } from "node:crypto";

import { Router } from "express";

import { env } from "../config/env.js";
import { metricsRegistry } from "../observability/metrics.js";

function tokenMatches(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = authorization.slice("Bearer ".length);
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createMetricsRouter(authToken = env.METRICS_AUTH_TOKEN): Router {
  const router = Router();

  router.get("/metrics", async (req, res) => {
    if (authToken && !tokenMatches(req.header("authorization"), authToken)) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "A valid metrics bearer token is required." },
      });
      return;
    }

    res.setHeader("content-type", metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });

  return router;
}

export const metricsRouter = createMetricsRouter();
