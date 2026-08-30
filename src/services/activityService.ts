import { paginateCursor, type CursorPage } from "./cursorPagination.js";

export type ActivityEvent = {
  id: string;
  type: string;
  account: string;
  assetId: string;
  amount: string;
  occurredAt: string;
  ledger: number;
  metadata?: Record<string, string>;
};

export type ActivityFilters = {
  account?: string;
  assetId?: string;
  type?: string;
  limit?: number;
  cursor?: string;
  snapshot?: string;
};

const events: ActivityEvent[] = [];

function sortedKey(event: ActivityEvent): string {
  return `${event.occurredAt}|${event.id}`;
}

export function recordActivity(event: ActivityEvent): ActivityEvent {
  if (!event.id || !event.type || !event.occurredAt) throw new Error("activity id, type, and occurredAt are required");
  if (events.some((existing) => existing.id === event.id)) return events.find((existing) => existing.id === event.id) as ActivityEvent;
  events.push({ ...event, metadata: event.metadata ? { ...event.metadata } : undefined });
  return event;
}

export function clearActivity(): void {
  events.length = 0;
}

export function listActivity(filters: ActivityFilters = {}): CursorPage<ActivityEvent> {
  const filtered = events.filter((event) =>
    (!filters.account || event.account === filters.account) &&
    (!filters.assetId || event.assetId === filters.assetId) &&
    (!filters.type || event.type === filters.type),
  );
  filtered.sort((left, right) => sortedKey(right).localeCompare(sortedKey(left)));
  return paginateCursor(filtered, {
    resource: "activity",
    limit: filters.limit,
    cursor: filters.cursor,
    snapshot: filters.snapshot,
    secret: process.env.CURSOR_SIGNING_SECRET,
    key: sortedKey,
    snapshotValue: (event) => event.occurredAt,
    descending: true,
  });
}
