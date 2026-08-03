# Price Oracle

`OracleService` provides one trusted-price interface over a primary source and
an optional fallback source. Sources implement `PriceSource`, so a future
Soroban contract reader can be added without changing consumers. The included
`HttpJsonPriceSource` supports an endpoint containing `{asset}` or appends an
`asset` query parameter.

Each HTTP source must return:

```json
{
  "asset": "XLM",
  "price": 0.1234,
  "timestamp": "2026-08-03T10:00:00Z"
}
```

## Trust Rules

- Asset codes are normalized and must match the requested asset.
- Prices must be finite and positive.
- Future timestamps and prices older than the staleness threshold are rejected.
- A new price cannot deviate from the last still-trusted price by more than
  `ORACLE_MAX_DEVIATION_PERCENT`.
- Every source call has a hard timeout. A failing, invalid, stale, or timed-out
  primary source moves to the fallback source.
- A cached price is returned immediately during its TTL. After the TTL, it may
  be used only as a safe fallback while its observation remains inside the
  staleness threshold. Once stale, the service throws `NoTrustedPriceError`.

This service never guesses, averages untrusted values, or silently returns a
stale price. Callers should treat `NoTrustedPriceError` as a fail-closed state
for collateral, liquidation, and borrowing decisions.

## Configuration

`ORACLE_PRIMARY_URL` is required when the service is instantiated. Configure an
optional independent fallback with `ORACLE_FALLBACK_URL`. Source names are used
only as stable log and metric labels. Keep the source set bounded; never use
asset IDs or request URLs as metric labels.
