# Protocol input validation

All lending action requests pass through one validation boundary before they
reach an action handler. The boundary is deliberately independent of Prisma,
Soroban, and the oracle so malformed input cannot cause database, network, or
ledger side effects.

## Canonical request

The accepted body is:

```json
{
  "walletAddress": "G...",
  "amount": "2.5000000",
  "asset": "XLM",
  "network": "testnet",
  "deadline": 1730000000
}
```

`asset`, `network`, and `deadline` have safe defaults for backward-compatible
clients: `XLM`, `testnet`, and now plus 60 seconds. New clients should send
them explicitly so the intended ledger domain is visible in logs and request
traces.

## Amount safety

Amounts must be decimal strings with no exponent or sign and at most seven
fractional digits. They are converted directly to integer protocol units with
`BigInt`; no JavaScript `number` is used for monetary arithmetic. Zero,
negative, malformed, and over-precision values are rejected. The absolute
amount is bounded below the protocol's 30-digit maximum before deeper layers
run.

The parser returns the original string, integer units, and source precision.
Keeping `raw` alongside `units` allows request logging to retain the exact
client representation without recomputing it from a rounded number. Callers
must use `units` for contract arguments and must not parse `raw` with
`parseFloat`.

## Asset and network policy

The initial allowlists are `XLM`, `USDC`, and `EURC`, and `testnet` and
`mainnet`. Unknown values are rejected rather than forwarded to a provider or
contract. Adding an asset requires updating the allowlist, oracle mapping,
contract configuration, and tests together. User-supplied asset contract IDs
are not accepted by this boundary.

## Deadline policy

Deadlines are safe integer Unix timestamps in seconds. A deadline cannot be in
the past or more than 30 days ahead of the validator's clock. Numeric strings
containing only digits are accepted for JSON/form compatibility; decimal,
exponent, negative, and unsafe integers are rejected. Production callers
should also apply a small clock-skew policy at the ledger submission layer.

The validator receives `nowSeconds` as an injectable argument in unit tests,
which makes boundary tests deterministic. Production code uses the current
server clock immediately before validation.

## Error contract

Invalid requests return HTTP 400 with a stable field-aware envelope:

```json
{
  "error": {
    "code": "INVALID_AMOUNT",
    "field": "amount",
    "message": "amount must be greater than zero"
  }
}
```

Codes include `INVALID_FIELD`, `INVALID_AMOUNT`, `AMOUNT_OUT_OF_RANGE`,
`UNSUPPORTED_ASSET`, `UNSUPPORTED_NETWORK`, and `INVALID_DEADLINE`. Messages
are safe for clients and do not include stack traces, SQL, provider responses,
secrets, or contract internals. Callers should branch on `code` and `field`,
not message text.

## Middleware placement

The middleware is registered before each lending action handler. A rejected
request stops the Express chain. A valid request receives the canonical parsed
body and then proceeds to the existing handler. Current handlers remain
`501 Not Implemented` placeholders; that response confirms validation passed
and preserves the existing API transition while the ledger actions are built.

Future position, market, oracle, and liquidation endpoints should reuse the
same parser or compose its smaller functions. Validation must happen before
authentication-dependent side effects, database writes, cache updates, quote
requests, Soroban simulation, or transaction submission.

## Security considerations

- Never accept a private key, secret, or signing material in a protocol body.
- Treat wallet addresses as identifiers and validate their public-key shape;
  ownership/authentication is a separate middleware concern.
- Keep integer amounts as `bigint` through contract argument construction.
- Do not infer an asset or network from a URL controlled by the client.
- Revalidate deadline freshness immediately before an external submission if
  validation and submission can be separated by a long-running operation.
- Keep error serialization limited to the stable code, field, and safe message.

## Test guarantees

Unit tests cover exact decimal parsing, precision boundaries, zero/negative and
oversized amounts, asset/network allowlists, deadline boundaries, defaults,
wallet shape, malformed deadlines, and stable typed errors. HTTP integration
tests prove invalid deposit/borrow requests stop at the validation boundary
and valid repayment input reaches the existing action handler.

The validator has no database or network dependency, so it can be used in
property tests that generate malformed strings and boundary timestamps. Any
future change to precision, maximum amount, allowlists, or deadline windows
must update both the exported constants and the contract/API documentation.
