# Circuit Breaker

Generic per-host circuit breaker for outbound HTTP calls in StellarLend Backend.

## Overview

The `CircuitBreaker` class provides a shared, tested primitive that any outbound
HTTP caller (Horizon, Soroban RPC, price oracle, webhook delivery) can wrap
around its requests. It prevents a degraded downstream host from being hammered
by every caller while it recovers.

## State Machine

```
  +----------+    failures > threshold     +----------+
  |  CLOSED  | --------------------------> |   OPEN   |
  | (normal) |                              | (reject) |
  +----------+                              +-----+----+
       ^                                          |
       |         cooldown elapsed                 |
       |    +-----------+                         |
       +----|HALF_OPEN  |<------------------------+
            | (1 probe) |
            +-----+-----+
                  |
        success --+-- failure --> back to OPEN
```

| Transition | Trigger |
|---|---|
| CLOSED -> OPEN | Failure rate >= `failureThreshold` **and** total calls >= `minSampleSize`, **or** consecutive failures >= `maxConsecutiveFailures` |
| OPEN -> HALF_OPEN | `cooldownMs` elapsed since `openedAt` |
| HALF_OPEN -> CLOSED | Probe call succeeds |
| HALF_OPEN -> OPEN | Probe call fails |

## Configuration

| Option | Default | Description |
|---|---|---|
| `failureThreshold` | `0.5` | Fraction of failures (0-1) that triggers OPEN |
| `minSampleSize` | `5` | Minimum calls before failure rate is evaluated |
| `cooldownMs` | `30_000` | Milliseconds to wait before probing (30s) |
| `maxConsecutiveFailures` | `20` | Consecutive failures that open the circuit regardless of ratio |

## Usage

```typescript
import { circuitBreaker } from "../lib/http/circuitBreaker.js";

const host = new URL(endpoint).hostname;

if (!circuitBreaker.shouldAllow(host)) {
  throw new Error("Circuit open - downstream unavailable");
}

try {
  const response = await fetch(endpoint, options);
  circuitBreaker.recordSuccess(host);
  return response;
} catch (err) {
  circuitBreaker.recordFailure(host);
  throw err;
}
```

## Metrics

Call `circuitBreaker.getMetrics()` to retrieve per-host state snapshots suitable
for Prometheus gauges or health-check endpoints:

```typescript
// Example health-check route
app.get("/health/circuits", (_req, res) => {
  res.json(circuitBreaker.getMetrics());
});
```

## Testing

```bash
npm test -- test/circuitBreaker.test.ts
```
