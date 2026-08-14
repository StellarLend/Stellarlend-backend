/**
 * Process entrypoint: boots the HTTP server and wires up graceful shutdown.
 */
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { initSentry } from "./lib/telemetry/sentry.js";

initSentry();
const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info("server started", { port: env.PORT, env: env.NODE_ENV });
});

async function shutdown(signal: string): Promise<void> {
  logger.info("shutting down", { signal });

  server.close(async (err) => {
    if (err) {
      logger.error("error while closing server", { message: err.message });
    }

    await prisma.$disconnect();
    process.exit(err ? 1 : 0);
  });

  // Force-exit if graceful shutdown hangs.
  setTimeout(() => {
    logger.error("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
