# Cursor pagination contract

Activity and market history are read from data that can change while a client
walks pages. Offset pagination is unstable: an insertion at the front shifts
every later offset and can duplicate or skip records. StellarLend uses signed,
opaque cursors and a request snapshot to make a traversal stable.

## Response shape

```json
{
  "data": [],
  "pagination": {
    "limit": 25,
    "hasMore": true,
    "nextCursor": "eyJ2ZXJzaW9uIjox...signature",
    "snapshot": "2026-08-30T12:00:00.000Z"
  }
}
```

The first request chooses a snapshot timestamp. Every subsequent cursor carries
that snapshot, the resource name, and the last stable key. The server signs all
three values with `CURSOR_SIGNING_SECRET`. Clients must treat the cursor as an
opaque token and pass it back unchanged.

## Ordering and snapshots

Activity is ordered by `occurredAt DESC, id DESC`; markets are ordered by asset
ID. A production database query must use the same composite ordering and
matching index. The snapshot filter excludes records whose event time is newer
than the first request’s snapshot. A new event therefore appears on a fresh
traversal, not halfway through an existing traversal.

When events share a timestamp, the unique ID is the tie breaker. A cursor points
to both values through its stable key. Do not replace this with a timestamp-only
cursor: equal timestamps would be skipped or repeated.

## Filters

`GET /api/v1/activity` accepts `account`, `assetId`, `type`, `limit`, `cursor`,
and `snapshot`. Filters are applied before pagination and must remain unchanged
while following a cursor. A cursor signed for `activity` cannot be used for
`markets`, and a cursor with a missing record is rejected rather than silently
starting over.

`GET /api/v1/markets` accepts `asset`, `limit`, `cursor`, and `snapshot`. The
existing ETag is calculated from the paginated response, so conditional GETs
remain useful for a specific page.

## Invalid cursor behavior

Malformed, unsigned, cross-resource, expired-format, or missing-record cursors
return a typed `INVALID_CURSOR` client error with HTTP 400. The API never trusts
decoded cursor JSON before verifying its HMAC. Signature comparison is constant
time and rejects unequal lengths before calling the comparison primitive.

Clients should discard an invalid cursor and restart from the first page. They
should not edit or retry a partially decoded token. A changed filter or a
cursor from a different environment is expected to fail closed.

## Indexing guidance

For SQL-backed activity, use an index that begins with fields used for the
filter and ends with the ordered snapshot key. Examples include:

```sql
create index activity_time_id_idx on activity (occurred_at desc, id desc);
create index activity_account_time_id_idx
  on activity (account, occurred_at desc, id desc);
create index activity_asset_time_id_idx
  on activity (asset_id, occurred_at desc, id desc);
```

The exact names depend on the migration. Verify the query plan in CI or a
staging database; an application-level cursor does not make an unindexed query
cheap. Keep page limits bounded to prevent a caller from turning one request
into a full table scan.

## Refresh and new data

Refreshing means starting a new traversal without the old cursor. It chooses a
new snapshot and can include records that arrived after the previous snapshot.
Following an existing cursor always uses its original snapshot. This gives
clients a choice: stable historical export or a new view of the latest data.

Indexers should call `recordActivity` with a deterministic event ID. Replaying
the same chain event is a no-op. A duplicate ID with different event facts must
be rejected by the durable repository and surfaced for reconciliation rather
than overwriting an earlier event.

## Review checklist

- [ ] Cursor payload is signed and opaque to clients.
- [ ] Resource, snapshot, and last key are authenticated together.
- [ ] Ordering has a unique tie breaker.
- [ ] Snapshot filtering is applied before the cursor boundary.
- [ ] Filters are applied before pagination and remain stable across pages.
- [ ] Invalid or missing cursors return typed 400 errors.
- [ ] Queries have indexes matching filters and order.
- [ ] Limits are bounded and final pages return `nextCursor: null`.
- [ ] Concurrent inserts appear only on a new snapshot.
- [ ] Tests cover tampering, refresh, filters, final pages, and duplicates.

## Query implementation notes

For a descending activity feed, the first page can be expressed as:

```sql
select id, type, account, asset_id, amount, occurred_at, ledger, metadata
from activity
where occurred_at <= :snapshot
  and (:account is null or account = :account)
  and (:asset_id is null or asset_id = :asset_id)
  and (:type is null or type = :type)
order by occurred_at desc, id desc
limit :limit_plus_one;
```

After a cursor, use the tuple boundary rather than an offset:

```sql
and (
  occurred_at < :last_occurred_at
  or (occurred_at = :last_occurred_at and id < :last_id)
)
```

Fetch one extra row to calculate `hasMore`, return only the requested number,
and encode the final row as the next cursor. The extra-row technique avoids a
separate count query and keeps response latency bounded for large histories.

For ascending market data, reverse the comparison and order direction. The
cursor codec does not expose this implementation detail to clients; the
resource-specific service owns it.

## Database migration guidance

An activity table should retain the chain identity needed for deduplication and
ordering. A representative model is:

```sql
create table activity (
  id text primary key,
  type text not null,
  account text not null,
  asset_id text not null,
  amount numeric(38, 18) not null,
  occurred_at timestamptz not null,
  ledger bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

The indexer should insert with `on conflict (id) do nothing` only when the
incoming event is byte-equivalent to the stored event. If the same event ID
has different facts, record an ingestion alert and stop overwriting history.
Chain reorg handling should either mark the event as reverted or use a stable
canonicality field; it must not silently move an event between cursor pages.

Recommended indexes for the initial filters are:

```sql
create index activity_order_idx on activity (occurred_at desc, id desc);
create index activity_account_order_idx
  on activity (account, occurred_at desc, id desc);
create index activity_asset_order_idx
  on activity (asset_id, occurred_at desc, id desc);
create index activity_type_order_idx
  on activity (type, occurred_at desc, id desc);
```

Add only indexes supported by measured query plans. A broad collection of
indexes increases ingestion cost and may hurt the write path. If combined
filters become common, create a composite index for the most selective stable
prefix and validate it with production-shaped data.

## Snapshot policy

The snapshot is an ISO timestamp in the current implementation. A database
adapter may use a ledger sequence instead, provided the sequence is monotonic
and can be compared for every row. Ledger snapshots are preferable when event
timestamps can arrive out of order. If a timestamp is used, the indexer must
define how late-arriving events are assigned to a snapshot.

Snapshots are not retention leases. A cursor can become invalid after history
compaction or a migration. In that case return `INVALID_CURSOR` and ask the
client to restart. Do not silently return a page from a different snapshot;
that would reintroduce skipped or duplicated records in exports.

## API examples

First activity page:

```http
GET /api/v1/activity?account=GABC&assetId=usdc&limit=50
```

Continuation:

```http
GET /api/v1/activity?account=GABC&assetId=usdc&limit=50&cursor=<opaque-token>
```

Filtered markets:

```http
GET /api/v1/markets?asset=USDC&limit=25
```

An invalid cursor response has a stable shape:

```json
{
  "error": {
    "code": "INVALID_CURSOR",
    "message": "cursor is invalid or expired"
  }
}
```

The API should not return the decoded cursor payload, HMAC material, internal
database IDs, or query-plan details in this error. Those values are useful in
server diagnostics only.

## Operational rollout

1. Deploy the cursor codec and tests behind the existing read endpoints.
2. Add database indexes concurrently where the database supports it.
3. Verify query plans for unfiltered and each supported filter combination.
4. Compare a cursor traversal with an offset traversal in staging fixtures.
5. Enable the new response metadata for clients that understand the contract.
6. Monitor invalid-cursor rate, page latency, and records per page.
7. Remove offset fallback only after client migration is complete.

During rollout, keep the old endpoint available behind an explicit version or
feature flag. Never interpret a cursor as an offset. A client that does not
understand `nextCursor` can continue using the old response only until its
deprecation deadline; the stable contract is the cursor-based response.

## Failure and recovery checks

- Insert a record newer than the snapshot and verify it is absent from the
  current traversal but present after refresh.
- Insert two records with the same event time and verify ID tie-breaking.
- Delete the cursor anchor and verify a typed invalid-cursor response.
- Change one cursor byte and verify signature rejection.
- Reuse an activity cursor for the markets resource and verify rejection.
- Request a limit above the maximum and verify bounded client failure.
- Replay an indexer event ID and verify one stored record.
- Compare filtered and unfiltered query plans before increasing limits.
