# Notifications API

Backs the frontend notification bell: list, mark-as-read, mark-all-as-read,
and delete a user's notifications. Every route is scoped to the caller.

## Caller identity (interim)

Real session auth (SEP-10 + JWT, see `src/routes/auth.ts`) isn't implemented
yet. Until it lands, these routes identify the caller via an `X-User-Id`
header (`src/middleware/requireUserId.ts`). A request without the header
gets `401 UNAUTHORIZED`. This is a single, documented call site to swap for
the real session once auth exists.

## Endpoints

All under `/api/v1/notifications`, all require `X-User-Id`.

### `GET /`

Lists the caller's notifications, newest first.

```
200 OK
{ "notifications": [{ "id", "userId", "title", "message", "type", "read", "createdAt" }, ...] }
```

A user with no notifications gets `{ "notifications": [] }`, not an error.

### `POST /:id/read`

Marks one notification as read.

```
200 OK
{ "notification": { ... } }
```

`404 NOT_FOUND` if the id doesn't exist _or_ belongs to another user — the
two cases are indistinguishable in the response, so a caller can't probe for
other users' notification ids.

### `POST /read-all`

Marks every unread notification for the caller as read.

```
200 OK
{ "count": <number marked read> }
```

### `DELETE /:id`

Deletes one notification.

```
204 No Content
```

`404 NOT_FOUND` under the same "doesn't exist or isn't yours" rule as
`POST /:id/read`.

## Data model

`Notification` (`prisma/schema.prisma`): `id`, `userId`, `title`, `message`,
`type`, `read`, `createdAt`, indexed on `(userId, createdAt)` for the list
query. `userId` is a plain string, not a foreign key to `Account` — see the
caller-identity note above.
