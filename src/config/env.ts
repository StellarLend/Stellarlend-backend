/**
 * Typed configuration loader.
 *
 * Validates required environment variables at boot with zod so the process
 * fails fast (and loudly) on misconfiguration instead of surfacing confusing
 * runtime errors later. Everything the rest of the app needs from `process.env`
 * should be read through the `env` object exported here, not `process.env`
 * directly, so it stays type-safe and centrally documented.
 *
 * See `.env.example` for the full list of variables and sane local defaults.
 */
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default("postgresql://stellarlend:stellarlend@localhost:5432/stellarlend?schema=public"),

  // Stellar network
  STELLAR_NETWORK: z.enum(["testnet", "mainnet", "futurenet"]).default("testnet"),
  STELLAR_HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  LENDING_POOL_CONTRACT_ID: z.string().optional(),

  // Auth
  AUTH_HOME_DOMAIN: z.string().default("localhost:4000"),
  AUTH_SERVER_SIGNING_SECRET: z.string().optional(),
  AUTH_JWT_SECRET: z.string().default("change-me-in-every-real-environment"),

  // Oracle
  ORACLE_PRIMARY_SOURCE: z.string().default("soroban"),
  ORACLE_PRICE_STALENESS_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(120),

  // Caching
  REDIS_URL: z.string().optional(),

  // Error tracking
  SENTRY_DSN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  SENTRY_ENVIRONMENT: z.string().optional(),

  // CORS
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration. See errors above.");
  }

  return parsed.data;
}

export const env = loadEnv();
