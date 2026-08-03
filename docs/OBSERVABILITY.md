# Observability

Every HTTP request receives an `x-request-id`. A caller-supplied ID is preserved
only when it contains 1-128 safe ASCII characters; otherwise the server creates
a UUID. The ID is propagated through `AsyncLocalStorage` and added to structured
JSON logs automatically.

Logger metadata recursively redacts authorization, cookie, password, secret,
token, API-key, private-key, seed, and mnemonic fields. Do not place sensitive
values in log messages or in fields with misleading names.

## Metrics

`GET /metrics` returns Prometheus text for:

- HTTP duration by method, normalized route, and status.
- Oracle request duration and outcomes by bounded source name.
- Last trusted oracle price age by asset and source.
- Stellar transaction submission outcomes by network.
- Indexer lag by network.

Set `METRICS_AUTH_TOKEN` to require `Authorization: Bearer <token>`. In
production, also expose the route only on a private network or through an
authenticated monitoring proxy. Never include wallet addresses, transaction
hashes, request IDs, or arbitrary paths as metric labels.

Recommended alerts:

- No successful oracle read for two staleness windows.
- Trusted price age above 75% of the configured staleness threshold.
- Sustained oracle timeout/error ratio above 5%.
- Indexer lag above the protocol's reconciliation window.
- A sudden increase in failed transaction submissions or HTTP 5xx responses.
