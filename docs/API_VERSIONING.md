# API Versioning

## Conventions

StellarLend-backend uses **URL-path versioning**: every route lives under a
versioned prefix such as `/api/v1/`. A new major version (e.g. `/api/v2`)
is introduced alongside the existing one, so consumers have a full transition
window to migrate.

| Aspect                          | Policy |
|---------------------------------|--------|
| Version scheme                  | `/api/v{major}` (e.g. `/api/v1/health`) |
| Stability guarantee             | No breaking changes within a major version |
| Transition window               | New major version ships side-by-side with the previous one |
| Deprecation notice              | `Deprecation` + `Sunset` headers per RFC 8594 |
| Removal                         | At least **6 months** after the `Sunset` date passes (or after one additional major version, whichever is longer) |

## Adding a new version

1. Create a new router file for the version (e.g. `src/routes/v2/`).
2. Mount it in `src/routes/index.ts` under the `/api/v2` prefix.
3. Apply the deprecation middleware to the previous version:
   ```ts
   app.use("/api/v1", deprecation({ sunset: "<target-date>" }));
   ```
4. Update this document with the new versions table.

## Deprecation middleware

The `src/middleware/deprecation.ts` module exports a factory function that
adds standard informational headers:

- `Deprecation: true` — signals the endpoint is deprecated (RFC 8594 § 4).
- `Sunset: <HTTP-date>` — target removal date for the deprecated version.
- `Link: <url>; rel="deprecation"` (optional) — migration guide or replacement docs.

**Important:** Deprecated routes continue to operate normally; the headers
are advisory only. Actual removal happens in a subsequent release after the
sunset date has passed.

### Usage

```ts
import { deprecation } from "./middleware/deprecation.js";

// Apply to the entire v1 router:
app.use("/api/v1", deprecation({
  sunset: "2026-03-01",
  link: "/docs/api-v2-migration",
}));
```

## Current versions

| Version | Status      | Sunset date | Mounted since |
|---------|-------------|-------------|---------------|
| v1      | Active      | N/A         | project start |

---

*StellarLend-backend follows the [StellarLend API stability guidelines](https://github.com/StellarLend).*
