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
  it("produces a 64-char hex string", () => {
    const h = hashFilter({ available: true });
    expect(h).toHaveLength(64);
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
});

describe("encodeCursor / decodeCursor round-trip", () => {
  const payload: CursorPayload = {
    lastId: "gHqVKr3xAWo",
    lastCreatedAt: "2026-04-19T15:23:04-05:00",
    filterHash: hashFilter({ available: true }),
  };

  it("round-trips a cursor payload", () => {
    const cursor = encodeCursor(payload);
    const decoded = decodeCursor(cursor, payload.filterHash);
    expect(decoded).toEqual(payload);
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

describe("isAfterCursor", () => {
  const cursor: CursorPayload = {
    lastId: "gHqVKr3xAWo",
    lastCreatedAt: "2026-04-19T15:23:04-05:00",
    filterHash: "irrelevant",
  };

  it("returns true when createdAt is strictly after cursor", () => {
    expect(isAfterCursor({ id: "anyId", createdAt: "2026-04-20T00:00:00Z" }, cursor)).toBe(true);
  });

  it("returns true when createdAt is equal and id is lexicographically greater", () => {
    expect(
      isAfterCursor({ id: "zZZZZZZZZZZ", createdAt: "2026-04-19T15:23:04-05:00" }, cursor),
    ).toBe(true);
  });

  it("returns false when createdAt is equal and id is equal", () => {
    expect(
      isAfterCursor({ id: "gHqVKr3xAWo", createdAt: "2026-04-19T15:23:04-05:00" }, cursor),
    ).toBe(false);
  });

  it("returns false when createdAt is before cursor", () => {
    expect(isAfterCursor({ id: "zZZZZZZZZZZ", createdAt: "2026-04-18T00:00:00Z" }, cursor)).toBe(
      false,
    );
  });

  it("returns false when createdAt is equal and id is lexicographically less", () => {
    expect(isAfterCursor({ id: "aaaaaaaaa", createdAt: "2026-04-19T15:23:04-05:00" }, cursor)).toBe(
      false,
    );
  });
});
