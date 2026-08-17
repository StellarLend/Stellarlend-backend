/**
 * Top-level router. Mounts the `/health` and `/ready` checks at the root, and
 * the versioned API surface under `/api/v1`.
 *
 * Add new route modules here as they're implemented (e.g. `positions.ts`,
 * `markets.ts`, `accountProfile.ts`, `admin/users.ts`) rather than mounting
 * them directly on the app in `src/app.ts`.
 */
import { Router } from "express";

import { authRouter } from "./auth.js";
import { healthRouter } from "./health.js";
import { lendingRouter } from "./lending.js";
import { marketsRouter } from "./markets.js";
import { notificationsRouter } from "./notifications.js";
import { positionsRouter } from "./positions.js";

export const rootRouter = Router();

rootRouter.use(healthRouter);

const apiV1Router = Router();
apiV1Router.use("/auth", authRouter);
apiV1Router.use("/lending", lendingRouter);
apiV1Router.use("/markets", marketsRouter);
apiV1Router.use("/notifications", notificationsRouter);
apiV1Router.use("/positions", positionsRouter);

rootRouter.use("/api/v1", apiV1Router);
