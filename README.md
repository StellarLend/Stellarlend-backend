# StellarLend Backend

The off-chain backend API for **StellarLend**, a lending protocol built on
Stellar/Soroban. This service is the layer between the
[StellarLend frontend](https://github.com/StellarLend/Stellarlend-frontend)
and the chain: it talks to Stellar Horizon and Soroban RPC, indexes
contract events, integrates price oracles, and exposes the REST/GraphQL API
that drives core lending actions (deposit, borrow, repay, withdraw,
liquidate) and position/market reads.

> **Status:** early scaffold. The pieces described above are being built out
> issue by issue — see the
> [open issues](https://github.com/StellarLend/Stellarlend-backend/issues)
> for the current roadmap. This repo currently ships a working server with a
> health check, a Prisma/Postgres data layer, and CI — most routes are
> intentionally `501 Not Implemented` stubs marking where real logic will go.

## Tech stack

- **Node.js** (LTS, 20+) + **TypeScript** (`strict` mode, ESM/NodeNext)
- **Express** for the HTTP layer
- **Prisma** + **PostgreSQL** for persistence
- **Zod** for env-var and request validation
- **prom-client** for Prometheus-compatible operational metrics
- **Vitest** + **Supertest** for testing
- **ESLint** + **Prettier** for linting/formatting
- **GitHub Actions** for CI

## Project structure

```
src/
  index.ts          Process entrypoint (binds the HTTP port, graceful shutdown)
  app.ts             Express app factory (used directly by tests via supertest)
  config/            Typed, validated environment configuration
  routes/            HTTP route definitions (controllers)
  services/          Business logic: Stellar/Soroban, indexer, oracle, etc.
  repositories/       Prisma-backed data access, one module per aggregate
  middleware/        Express middleware (error handling, request logging, ...)
  observability/     Prometheus metrics and operational instrumentation
  graphql/           GraphQL schema (planned, not wired up yet)
  lib/               Small shared utilities (logger, Prisma client singleton)
  types/             Shared TypeScript types
prisma/
  schema.prisma      Data model (currently placeholder Account/Position models)
test/                Vitest + Supertest test suite
```

Each layer only depends on the ones "below" it: routes call services and
repositories, services call repositories, repositories call Prisma. This
keeps later feature work (Stellar integration, indexer, oracle, auth, etc.)
easy to drop in without restructuring.

## Running locally

### Prerequisites

- Node.js 20+
- Docker (for local Postgres), or a Postgres instance you already have

### Setup

```bash
# 1. Install dependencies (also runs `prisma generate`)
npm install

# 2. Copy the example env file and adjust as needed
cp .env.example .env

# 3. Start Postgres locally
docker compose up -d

# 4. Apply the Prisma schema to your database
npx prisma migrate dev

# 5. Start the dev server (watches for changes)
npm run dev
```

The server boots on `http://localhost:4000` by default (see `PORT` in
`.env`). Check it's alive:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/ready   # also checks the DB connection
curl http://localhost:4000/metrics # use Bearer auth when configured
```

### Scripts

| Script                    | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `npm run dev`             | Start the dev server with hot reload (`tsx watch`) |
| `npm run build`           | Type-check and compile to `dist/`                  |
| `npm start`               | Run the compiled server from `dist/`               |
| `npm run lint`            | Lint with ESLint                                   |
| `npm run format`          | Format with Prettier                               |
| `npm run typecheck`       | Type-check without emitting                        |
| `npm test`                | Run the Vitest test suite                          |
| `npm run prisma:generate` | Regenerate the Prisma client                       |

## Environment variables

See [`.env.example`](./.env.example) for the full list with comments. The
loader in `src/config/env.ts` validates these with `zod` at boot and the
process exits immediately if something required is missing or malformed.

The oracle source contract, fallback behavior, and safety checks are documented
in [`docs/ORACLE.md`](./docs/ORACLE.md). Logging, request correlation, metrics,
and alerting guidance are documented in
[`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md).

## Contributing

This repo is worked on via the issue tracker — most issues include a
detailed spec and suggested files. Please open a PR against `main` and make
sure `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test` all
pass (CI runs the same checks).
