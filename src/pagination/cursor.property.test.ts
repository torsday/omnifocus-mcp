/**
 * Property tests for the cursor codec (encode → decode → encode stability).
 *
 * Fast-check generates arbitrary `CursorPayload` values and asserts:
 *   1. `encodeCursor(payload)` is a valid base64url string (no `+`, `/`, `=`)
 *   2. `decodeCursor(encodeCursor(payload), payload.filterHash)` returns a
 *      structurally equivalent payload (round-trip fidelity)
 *   3. Re-encoding the decoded payload yields the same cursor string (idempotency)
 *   4. A cursor encoded with hash A always rejects when decoded with hash B ≠ A
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CursorPayload, decodeCursor, encodeCursor } from "./cursor.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate a valid filterHash (64-char hex, as SHA-256 produces). */
const filterHashArb = fc.hexaString({ minLength: 64, maxLength: 64 });

/** Generate a CursorPayload with arbitrary string id, sort value, and filterHash. */
const cursorPayloadArb = fc.record<CursorPayload>({
  lastId: fc.string({ minLength: 1, maxLength: 64 }),
  lastSortValue: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: null }),
  filterHash: filterHashArb,
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("cursor codec — property tests", () => {
  it("encodeCursor produces only base64url-safe characters", () => {
    fc.assert(
      fc.property(cursorPayloadArb, (payload) => {
        const encoded = encodeCursor(payload);
        // base64url: A-Z a-z 0-9 - _  (no + / =)
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      }),
      { numRuns: 200 },
    );
  });

  it("decode(encode(payload)) round-trips every field", () => {
    fc.assert(
      fc.property(cursorPayloadArb, (payload) => {
        const encoded = encodeCursor(payload);
        const decoded = decodeCursor(encoded, payload.filterHash);
        expect(decoded.lastId).toBe(payload.lastId);
        expect(decoded.lastSortValue).toBe(payload.lastSortValue);
        expect(decoded.filterHash).toBe(payload.filterHash);
      }),
      { numRuns: 200 },
    );
  });

  it("encode(decode(encode(payload))) is idempotent", () => {
    fc.assert(
      fc.property(cursorPayloadArb, (payload) => {
        const encoded = encodeCursor(payload);
        const decoded = decodeCursor(encoded, payload.filterHash);
        const reEncoded = encodeCursor(decoded);
        expect(reEncoded).toBe(encoded);
      }),
      { numRuns: 200 },
    );
  });

  it("cursor encoded with one filterHash rejects when decoded with a different hash", () => {
    fc.assert(
      fc.property(cursorPayloadArb, filterHashArb, (payload, differentHash) => {
        fc.pre(differentHash !== payload.filterHash);
        const encoded = encodeCursor(payload);
        expect(() => decodeCursor(encoded, differentHash)).toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("lastSortValue: null round-trips as null (not undefined or empty string)", () => {
    fc.assert(
      fc.property(
        fc.record<CursorPayload>({
          lastId: fc.string({ minLength: 1, maxLength: 32 }),
          lastSortValue: fc.constant(null),
          filterHash: filterHashArb,
        }),
        (payload) => {
          const decoded = decodeCursor(encodeCursor(payload), payload.filterHash);
          expect(decoded.lastSortValue).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
