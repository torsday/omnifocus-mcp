import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/index.js";
import {
  type CursorPayload,
  decodeCursor,
  encodeCursor,
  hashFilter,
  isAfterCursor,
} from "./cursor.js";

describe("hashFilter", () => {
  it("produces a 16-char hex string (64-bit truncation, #802)", () => {
    const h = hashFilter({ available: true });
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", () => {
    const a = hashFilter({ available: true, limit: 50 });
    const b = hashFilter({ available: true, limit: 50 });
    expect(a).toBe(b);
  });

  it("is stable regardless of key order", () => {
    const a = hashFilter({ available: true, limit: 50 });
    const b = hashFilter({ limit: 50, available: true });
    expect(a).toBe(b);
  });

  it("differs for different filters", () => {
    const a = hashFilter({ available: true });
    const b = hashFilter({ available: false });
    expect(a).not.toBe(b);
  });

  it("ignores undefined values", () => {
    const a = hashFilter({ available: true });
    const b = hashFilter({ available: true, projectId: undefined });
    expect(a).toBe(b);
  });

  // #760 — nested-key ordering must not affect the hash. Latent today
  // (no caller passes a nested filter) but a tripwire for any future
  // shape change to `taskService.normalize` / `searchService` filters.
  it("is invariant under nested-object key reordering", () => {
    const a = hashFilter({ scope: { x: 1, y: 2 } });
    const b = hashFilter({ scope: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });

  it("distinguishes nested-object value changes", () => {
    const a = hashFilter({ scope: { x: 1 } });
    const b = hashFilter({ scope: { x: 2 } });
    expect(a).not.toBe(b);
  });

  it("ignores undefined values inside nested objects", () => {
    const a = hashFilter({ scope: { x: 1 } });
    const b = hashFilter({ scope: { x: 1, y: undefined } });
    expect(a).toBe(b);
  });
});

describe("encodeCursor / decodeCursor round-trip", () => {
  const payload: CursorPayload = {
    lastId: "gHqVKr3xAWo",
    lastSortValue: "2026-04-19T15:23:04-05:00",
    filterHash: hashFilter({ available: true }),
  };

  it("round-trips a cursor payload", () => {
    const cursor = encodeCursor(payload);
    const decoded = decodeCursor(cursor, payload.filterHash);
    expect(decoded).toEqual(payload);
  });

  it("round-trips a cursor payload with null sortValue", () => {
    const nullPayload: CursorPayload = {
      lastId: "gHqVKr3xAWo",
      lastSortValue: null,
      filterHash: hashFilter({ available: true }),
    };
    const cursor = encodeCursor(nullPayload);
    const decoded = decodeCursor(cursor, nullPayload.filterHash);
    expect(decoded).toEqual(nullPayload);
  });

  it("produces a base64url string (no +, /, or =)", () => {
    const cursor = encodeCursor(payload);
    expect(cursor).not.toContain("+");
    expect(cursor).not.toContain("/");
    expect(cursor).not.toContain("=");
  });

  it("throws ValidationError on tampered (non-base64url) input", () => {
    expect(() => decodeCursor("not!!valid@#", payload.filterHash)).toThrow(ValidationError);
  });

  it("throws ValidationError when filterHash mismatches", () => {
    const cursor = encodeCursor(payload);
    const differentHash = hashFilter({ completed: true });
    expect(() => decodeCursor(cursor, differentHash)).toThrow(ValidationError);
  });

  it("includes filterHash mismatch details in the error", () => {
    const cursor = encodeCursor(payload);
    const differentHash = hashFilter({ completed: true });
    let err: ValidationError | undefined;
    try {
      decodeCursor(cursor, differentHash);
    } catch (e) {
      err = e as ValidationError;
    }
    expect(err?.details).toMatchObject({
      cursorFilterHash: payload.filterHash,
      currentFilterHash: differentHash,
    });
  });

  it("throws ValidationError on missing required fields", () => {
    const bad = Buffer.from(JSON.stringify({ lastId: "abc" })).toString("base64url");
    expect(() => decodeCursor(bad, payload.filterHash)).toThrow(ValidationError);
  });

  it("throws ValidationError on non-JSON payload", () => {
    const bad = Buffer.from("not json").toString("base64url");
    expect(() => decodeCursor(bad, payload.filterHash)).toThrow(ValidationError);
  });
});

describe("isAfterCursor — ASC (default)", () => {
  const cursor: CursorPayload = {
    lastId: "gHqVKr3xAWo",
    lastSortValue: "2026-04-19T15:23:04-05:00",
    filterHash: "irrelevant",
  };

  it("returns true when sortValue is strictly after cursor", () => {
    expect(isAfterCursor({ id: "anyId", sortValue: "2026-04-20T00:00:00Z" }, cursor)).toBe(true);
  });

  it("returns true when sortValue is equal and id is lexicographically greater", () => {
    expect(
      isAfterCursor({ id: "zZZZZZZZZZZ", sortValue: "2026-04-19T15:23:04-05:00" }, cursor),
    ).toBe(true);
  });

  it("returns false when sortValue is equal and id is equal", () => {
    expect(
      isAfterCursor({ id: "gHqVKr3xAWo", sortValue: "2026-04-19T15:23:04-05:00" }, cursor),
    ).toBe(false);
  });

  it("returns false when sortValue is before cursor", () => {
    expect(isAfterCursor({ id: "zZZZZZZZZZZ", sortValue: "2026-04-18T00:00:00Z" }, cursor)).toBe(
      false,
    );
  });

  it("returns false when sortValue is equal and id is lexicographically less", () => {
    expect(isAfterCursor({ id: "aaaaaaaaa", sortValue: "2026-04-19T15:23:04-05:00" }, cursor)).toBe(
      false,
    );
  });
});

describe("isAfterCursor — DESC", () => {
  const cursor: CursorPayload = {
    lastId: "gHqVKr3xAWo",
    lastSortValue: "2026-04-19T15:23:04-05:00",
    filterHash: "irrelevant",
  };

  it("returns true when sortValue is strictly before cursor (desc)", () => {
    expect(isAfterCursor({ id: "anyId", sortValue: "2026-04-18T00:00:00Z" }, cursor, "desc")).toBe(
      true,
    );
  });

  it("returns false when sortValue is after cursor (desc)", () => {
    expect(isAfterCursor({ id: "anyId", sortValue: "2026-04-20T00:00:00Z" }, cursor, "desc")).toBe(
      false,
    );
  });
});

describe("isAfterCursor — null sortValue (nulls-last)", () => {
  const cursorWithNull: CursorPayload = {
    lastId: "id_aaa",
    lastSortValue: null,
    filterHash: "irrelevant",
  };
  const cursorWithValue: CursorPayload = {
    lastId: "id_aaa",
    lastSortValue: "2026-04-19T00:00:00Z",
    filterHash: "irrelevant",
  };

  it("null item is after non-null cursor in ASC (nulls last)", () => {
    expect(isAfterCursor({ id: "id_bbb", sortValue: null }, cursorWithValue, "asc")).toBe(true);
  });

  it("null item is NOT after null cursor with smaller id (both null)", () => {
    expect(isAfterCursor({ id: "id_aaa", sortValue: null }, cursorWithNull, "asc")).toBe(false);
  });

  it("null item with greater id is after null cursor (both null, tie-break)", () => {
    expect(isAfterCursor({ id: "id_zzz", sortValue: null }, cursorWithNull, "asc")).toBe(true);
  });

  it("non-null item is NOT after null cursor in ASC (item is before null)", () => {
    expect(
      isAfterCursor({ id: "id_bbb", sortValue: "2026-04-19T00:00:00Z" }, cursorWithNull, "asc"),
    ).toBe(false);
  });

  it("non-null item is after null cursor in DESC", () => {
    expect(
      isAfterCursor({ id: "id_bbb", sortValue: "2026-04-19T00:00:00Z" }, cursorWithNull, "desc"),
    ).toBe(true);
  });
});
