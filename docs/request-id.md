# Request Correlation-ID Middleware

## Overview

Every HTTP request processed by the StellarLend backend carries a **correlation
identifier** (`X-Request-ID`). This ID is:

- **Generated** as a RFC-9562 v4 UUID if the client does not supply one.
- **Accepted** from the client via the `X-Request-ID` request header when present.
- **Echoed** back in the `X-Request-ID` response header on every response.
- **Propagated** through `AsyncLocalStorage` so any code in the call stack —
  route handlers, services, repository calls — can retrieve it via
  `getRequestId()` without explicit parameter passing.
- **Attached** to every structured log line emitted by `requestLogger`.

## Usage

### Retrieving the ID in downstream code

```ts
import { getRequestId } from "../lib/requestContext.js";

const id = getRequestId(); // e.g. "550e8400-e29b-41d4-a716-446655440000"
```

When called outside of an HTTP request (e.g. during server bootstrap or inside
a background job not seeded with a context), `getRequestId()` returns `undefined`.

### Carrying the ID into background jobs

When a request handler enqueues a background job (BullMQ), the correlation ID
should be read from the context and included in the job payload so worker logs
can be joined back to the originating request:

```ts
import { getRequestId } from "../lib/requestContext.js";

await queue.add("my-job", {
  requestId: getRequestId(),
  // ... other payload fields
});
```

### Logging

The `requestLogger` middleware automatically includes `requestId` in every
`"request completed"` log line — no extra work required.

To include the ID in custom log calls, pass it explicitly:

```ts
import { getRequestId } from "../lib/requestContext.js";
import { logger } from "../lib/logger.js";

logger.info("asset price refreshed", { requestId: getRequestId(), asset: "XLM" });
```

## Implementation Files

| File | Role |
|------|------|
| `src/lib/requestContext.ts` | `AsyncLocalStorage` store + `getRequestId()` / `runWithContext()` helpers |
| `src/middleware/requestId.ts` | Express middleware: generate/accept/echo `X-Request-ID` |
| `src/middleware/requestLogger.ts` | Updated to read `requestId` from context and include in log lines |
| `src/app.ts` | Wires `requestId` middleware before all other handlers |
| `test/middleware/requestId.test.ts` | Tests covering generation, acceptance, echo, and propagation |
