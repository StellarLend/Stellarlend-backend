# Transactionally consistent portfolio positions

Portfolio reads combine an account revision with all of that account's
positions. Position mutations update the position and the account revision in
one serializable transaction. This prevents a reader from observing a
collateral value from one state with a debt value from another state.

## Revision model

`Account.portfolioVersion` is a monotonic revision for the whole portfolio.
Each `Position.version` is a row-level diagnostic version. The account
revision is the cache and snapshot boundary; the position revision helps
explain which row changed during an incident.

The migration initializes both fields to `1`, so existing accounts and
positions remain readable. New writes increment the account revision only
after the position write succeeds. The mutation returns a snapshot carrying
the new revision and the complete position set.

## Consistent reads

`ConsistentPositionService.readPortfolio(accountId)` executes the account
revision read and position list inside one serializable transaction. The
returned positions are sorted by asset before caching, making response order
stable. A caller receives either the complete snapshot for one revision or an
error; it does not receive separately fetched balance and debt values.

The cache stores defensive copies. A cache hit returns another copy so a route
cannot mutate the cached value through a response object. Cache state is
process-local in this minimal backend and should be replaced with a shared
cache only if the revision is included in invalidation or version checks.

## Mutation boundary

The mutation sequence is:

1. Validate that deltas are non-negative.
2. Begin a serializable transaction.
3. Lock/read the account revision.
4. Compare it with the caller's `expectedPortfolioVersion`.
5. Update or create the position.
6. Increment the account revision with the expected revision guard.
7. Read the complete position set in the same transaction.
8. Commit.
9. Invalidate and repopulate the cache only after commit resolves.

If any step before commit fails, the database adapter rolls back all writes and
the cache remains untouched. A stale expected revision returns the typed
`VERSION_CONFLICT` error, allowing a caller to reread instead of applying a
mutation to an unknown state.

The in-memory test adapter models the transaction boundary. The production
Prisma adapter should implement `PositionDatabase.transaction` with
`isolationLevel: Serializable`, `SELECT ... FOR UPDATE` for the account row,
and conditional updates for the expected revision. It should map Prisma
serialization error `P2034` and PostgreSQL `40001`/`40P01` to the retry path.

## Serialization retries

Serializable transactions can fail safely under concurrent writes. The
service retries only recognized serialization/deadlock codes, with bounded
attempts and backoff. Domain errors such as a missing account, stale version,
or invalid balance are not retried because repeating them cannot make them
successful and could duplicate caller work.

The default retry budget is three total transaction attempts. A production
adapter may tune the delay, but it should keep a finite budget and return a
stable error after exhaustion. Callers should treat exhausted serialization as
a retryable request failure with their own idempotency key, not as evidence
that a mutation committed.

## Cache invalidation

Invalidation is deliberately after the transaction promise. Invalidating
before the database commit creates a race where a concurrent reader repopulates
the cache with the old value and the failed mutation leaves the cache empty or
misleading. Invalidating after commit means a rollback preserves the known
good snapshot. The service sets the committed snapshot immediately after
deletion, avoiding an unnecessary stale read.

If a future distributed cache is used, publish the new account revision only
after commit and make cache consumers reject snapshots with a revision older
than their last observed revision. A cache entry must never be assembled from
independent balance and debt keys.

## Failure and restart behavior

A process restart clears the current in-memory cache; the next read loads a
complete snapshot from the database. Database rows retain their account and
position revisions, so the restart cannot create a mixed-version response.
An interrupted transaction is rolled back by PostgreSQL. An interrupted
committed transaction is visible with its new revision and is safe to read.

The service does not attempt to repair negative balances, force a revision, or
silently accept a stale write. Those conditions are returned as typed errors
and should be surfaced through the API's stable error envelope.

## Integration guidance

Routes should pass the revision returned by a prior portfolio read as
`expectedPortfolioVersion` on a mutation. On `VERSION_CONFLICT`, return a
conflict response and ask the client to refresh. Do not automatically merge
two user-intended money movements unless the product explicitly defines that
behavior.

Indexer writes that update multiple positions for one account should use the
same account lock and increment the account revision once per committed batch.
External Soroban submissions should not be performed while holding the
database transaction. Persist a pending intent first, then submit externally,
and reconcile confirmation separately.

## Test coverage

The focused suite verifies serializable read wiring, stable ordering, cache
reuse, revision increments, stale-write rejection, rollback preservation,
serialization retry, negative-balance rejection, and missing-account errors.
The fake database uses copy-on-write working state so the tests assert that
failed callbacks cannot leak partial position or revision updates.

## Remaining limitations

The current repository is a minimal scaffold and its HTTP position/lending
routes remain placeholders. This service establishes the transaction contract
for those routes without claiming that the unfinished endpoint surface is
complete. A production implementation still needs a Prisma repository,
request validation, authentication/ownership checks, distributed cache policy,
and database integration tests against PostgreSQL.

## Review checklist

- Does every portfolio response carry one account revision?
- Are all balance and debt reads sourced from the same transaction snapshot?
- Does every write supply an expected revision or an explicit idempotency key?
- Is the account row locked before evaluating the revision?
- Are serialization failures retried only a finite number of times?
- Does a failed transaction leave both the database and cache unchanged?
- Is cache invalidation ordered after commit?
- Are restart and stale-cache cases covered by an integration test?
- Are on-chain submission and database transaction lifetimes kept separate?

Any new repository method that returns combined portfolio values should answer
these questions before it is exposed to a route. A method that returns a
position row alone may use a row version, but a method that combines rows must
carry the account revision as its consistency token.
