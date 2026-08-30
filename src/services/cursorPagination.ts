import crypto from "node:crypto";

export type CursorPage<T> = {
  data: T[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null; snapshot: string };
};

type CursorPayload = { version: 1; resource: string; snapshot: string; lastKey: string };

export class InvalidCursorError extends Error {
  readonly code = "INVALID_CURSOR";
  readonly statusCode = 400;

  constructor(message = "cursor is invalid or expired") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export type CursorPaginationOptions<T> = {
  resource: string;
  limit?: number;
  cursor?: string;
  snapshot?: string;
  secret?: string;
  key: (item: T) => string;
  snapshotValue: (item: T) => string;
  descending?: boolean;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_SECRET = "stellarlend-cursor-development-only";

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new InvalidCursorError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function readCursor(value: string, resource: string, secret: string): CursorPayload {
  try {
    const [encoded, received] = value.split(".");
    if (!encoded || !received) throw new Error("missing cursor parts");
    const expected = sign(encoded, secret);
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    if (receivedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(receivedBytes, expectedBytes)) {
      throw new Error("cursor signature mismatch");
    }
    const payload = JSON.parse(decode(encoded)) as Partial<CursorPayload>;
    if (payload.version !== 1 || payload.resource !== resource || !payload.snapshot || !payload.lastKey) {
      throw new Error("invalid cursor payload");
    }
    if (!Number.isFinite(Date.parse(payload.snapshot))) throw new Error("invalid snapshot");
    return payload as CursorPayload;
  } catch {
    throw new InvalidCursorError();
  }
}

function writeCursor(payload: CursorPayload, secret: string): string {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/** Paginates an indexed collection with a signed, snapshot-bound cursor. */
export function paginateCursor<T>(items: readonly T[], options: CursorPaginationOptions<T>): CursorPage<T> {
  const limit = safeLimit(options.limit);
  const secret = options.secret || DEFAULT_SECRET;
  const cursor = options.cursor ? readCursor(options.cursor, options.resource, secret) : undefined;
  const snapshot = cursor?.snapshot || options.snapshot || new Date().toISOString();
  if (!Number.isFinite(Date.parse(snapshot))) throw new InvalidCursorError("snapshot is invalid");
  const snapshotMs = Date.parse(snapshot);
  const visible = items.filter((item) => Date.parse(options.snapshotValue(item)) <= snapshotMs).slice().sort((left, right) => {
    const comparison = options.key(left).localeCompare(options.key(right));
    return options.descending ? -comparison : comparison;
  });
  const after = cursor ? visible.findIndex((item) => options.key(item) === cursor.lastKey) + 1 : 0;
  if (cursor && after === 0) throw new InvalidCursorError("cursor record is not in the snapshot");
  const data = visible.slice(after, after + limit);
  const hasMore = after + data.length < visible.length;
  const last = data.at(-1);
  const nextCursor = hasMore && last ? writeCursor({ version: 1, resource: options.resource, snapshot, lastKey: options.key(last) }, secret) : null;
  return { data, pagination: { limit, hasMore, nextCursor, snapshot } };
}

export function cursorSecret(): string {
  return process.env.CURSOR_SIGNING_SECRET || DEFAULT_SECRET;
}
