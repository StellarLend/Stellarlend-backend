import { describe, expect, it } from "vitest";
import { InvalidCursorError, paginateCursor } from "./cursorPagination.js";

type Row = { id: string; updatedAt: string };
const rows: Row[] = [
  { id: "a", updatedAt: "2026-08-30T00:00:00.000Z" },
  { id: "b", updatedAt: "2026-08-30T00:00:00.000Z" },
  { id: "c", updatedAt: "2026-08-30T00:00:00.000Z" },
];

function page(cursor?: string) {
  return paginateCursor(rows, {
    resource: "rows",
    limit: 2,
    cursor,
    snapshot: "2026-08-31T00:00:00.000Z",
    secret: "test-secret",
    key: (row) => row.id,
    snapshotValue: (row) => row.updatedAt,
  });
}

describe("cursor pagination", () => {
  it("returns stable ordered pages and metadata", () => {
    const first = page();
    expect(first.data.map((row) => row.id)).toEqual(["a", "b"]);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.snapshot).toBe("2026-08-31T00:00:00.000Z");
    const second = page(first.pagination.nextCursor ?? undefined);
    expect(second.data.map((row) => row.id)).toEqual(["c"]);
    expect(second.pagination.nextCursor).toBeNull();
  });

  it("keeps records inserted after the snapshot out of every page", () => {
    const snapshot = page();
    const refreshed = [...rows, { id: "d", updatedAt: "2026-09-01T00:00:00.000Z" }];
    const continued = paginateCursor(refreshed, {
      resource: "rows",
      limit: 2,
      cursor: snapshot.pagination.nextCursor ?? undefined,
      secret: "test-secret",
      key: (row) => row.id,
      snapshotValue: (row) => row.updatedAt,
    });
    expect(continued.data.map((row) => row.id)).toEqual(["c"]);
  });

  it("rejects tampered, cross-resource, and missing-record cursors", () => {
    const cursor = page().pagination.nextCursor as string;
    expect(() => page(`${cursor.slice(0, -1)}x`)).toThrow(InvalidCursorError);
    expect(() => paginateCursor(rows, {
      resource: "different",
      cursor,
      secret: "test-secret",
      key: (row) => row.id,
      snapshotValue: (row) => row.updatedAt,
    })).toThrow(InvalidCursorError);
    expect(() => paginateCursor(rows.filter((row) => row.id !== "b"), {
      resource: "rows",
      cursor,
      secret: "test-secret",
      key: (row) => row.id,
      snapshotValue: (row) => row.updatedAt,
    })).toThrow(InvalidCursorError);
  });

  it("rejects invalid limits and malformed snapshots", () => {
    expect(() => paginateCursor(rows, { resource: "rows", limit: 0, key: (row) => row.id, snapshotValue: (row) => row.updatedAt })).toThrow(InvalidCursorError);
    expect(() => paginateCursor(rows, { resource: "rows", snapshot: "not-a-date", key: (row) => row.id, snapshotValue: (row) => row.updatedAt })).toThrow(InvalidCursorError);
  });
});
