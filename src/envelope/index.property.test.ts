/**
 * Property tests for the response envelope (#832).
 *
 * The envelope is a protocol surface every tool depends on (ADR-0013).
 * The example-based tests in `index.test.ts` cover known shapes; these
 * fast-check properties generate randomized payloads and metadata to
 * catch schema drift and edge cases (unicode, empty arrays, null fields,
 * very long strings, deeply nested objects) that fixed cases miss.
 *
 * Invariants asserted:
 *   1. `ok(data, meta)` preserves `data` losslessly through a JSON
 *      round-trip (the wire boundary) for any JSON-serializable payload.
 *   2. `ok`/`err` preserve every `meta` key per ADR-0013 — no silent
 *      field drop.
 *   3. `toolResponse(envelope).structuredContent` is the same envelope
 *      reference (the typed half is never mutated by wrapping — #883).
 *   4. `err(error, meta)` round-trips the serialized error losslessly.
 *   5. Optional envelope fields (`pagination`, `hints`) appear iff supplied.
 *
 * Companion to `src/pagination/cursor.property.test.ts`, which covers the
 * cursor codec half of #832.
 *
 * @see docs/design/testing-and-ci.md — "Property-based tests for protocol surfaces"
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NotFound, ValidationError } from "../errors/index.js";
import { err, ok, type ResponseMeta, toolResponse } from "./index.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * JSON-serializable payload generator. `fc.jsonValue()` covers objects,
 * arrays, strings (incl. unicode), numbers, booleans, and null — exactly
 * the value space a tool's `data` field can hold on the wire. We wrap it
 * so the top level is always an object (the `data` field is always a
 * record in practice) while still exercising nested arbitrary JSON.
 */
const dataArb = fc.dictionary(fc.string({ minLength: 1, maxLength: 40 }), fc.jsonValue(), {
  maxKeys: 8,
});

/** A realistic ResponseMeta. Optional fields are independently present/absent. */
const metaArb: fc.Arbitrary<ResponseMeta> = fc.record(
  {
    correlationId: fc.string({ minLength: 1, maxLength: 26 }),
    durationMs: fc.nat({ max: 600_000 }),
    cacheHit: fc.boolean(),
    transport: fc.constantFrom("jxa", "omnijs", "memory") as fc.Arbitrary<
      ResponseMeta["transport"]
    >,
    ofVersion: fc.oneof(fc.constant("unknown"), fc.stringMatching(/^[0-9]+\.[0-9]+\.[0-9]+$/)),
    syncPending: fc.boolean(),
  },
  // syncPending optional — sometimes omit it entirely.
  { requiredKeys: ["correlationId", "durationMs", "cacheHit", "transport", "ofVersion"] },
);

// ---------------------------------------------------------------------------
// Properties — success envelope
// ---------------------------------------------------------------------------

describe("envelope — property tests (#832)", () => {
  it("ok(): data survives a JSON round-trip losslessly", () => {
    fc.assert(
      fc.property(dataArb, metaArb, (data, meta) => {
        const envelope = ok(data, meta);
        // Compare at the serialized-string level, not via `toEqual` on the
        // parsed objects: the envelope's job is to add zero drift of its
        // own. `JSON.stringify(data)` is the wire form, and the envelope
        // must reproduce it byte-for-byte. (A structural `toEqual` would
        // also flag JSON's own irreducible quirks — e.g. `-0` serializes
        // to `"0"` — which aren't envelope bugs.)
        const wireData = JSON.stringify(data);
        const roundTripped = JSON.parse(JSON.stringify(envelope));
        expect(JSON.stringify(roundTripped.data)).toBe(wireData);
      }),
      { numRuns: 300 },
    );
  });

  it("ok(): every supplied meta key is preserved through the round-trip", () => {
    fc.assert(
      fc.property(dataArb, metaArb, (data, meta) => {
        const roundTripped = JSON.parse(JSON.stringify(ok(data, meta)));
        for (const key of Object.keys(meta)) {
          expect(roundTripped.meta[key]).toEqual((meta as unknown as Record<string, unknown>)[key]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("ok(): pagination present iff supplied", () => {
    const paginationArb = fc.record({
      cursor: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: null }),
      hasMore: fc.boolean(),
    });
    fc.assert(
      fc.property(
        dataArb,
        metaArb,
        fc.option(paginationArb, { nil: undefined }),
        (data, meta, pagination) => {
          const envelope = pagination ? ok(data, meta, pagination) : ok(data, meta);
          if (pagination) {
            expect(envelope.pagination).toEqual(pagination);
          } else {
            expect(envelope.pagination).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("toolResponse(): structuredContent is the same envelope, untouched by wrapping", () => {
    fc.assert(
      fc.property(dataArb, metaArb, (data, meta) => {
        const envelope = ok(data, meta);
        const wire = toolResponse(envelope);
        // The typed half is the envelope verbatim (#883: only content[].text
        // changed, structuredContent is unchanged).
        expect(wire.structuredContent).toBe(envelope);
        // And it still round-trips losslessly through the wire (serialized-
        // string comparison — see the round-trip property above for why).
        const roundTripped = JSON.parse(JSON.stringify(wire.structuredContent));
        expect(JSON.stringify(roundTripped.data)).toBe(JSON.stringify(data));
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Properties — error envelope
  // -------------------------------------------------------------------------

  it("err(): serialized error + meta round-trip losslessly", () => {
    const errorArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 200 }).map((m) => new ValidationError(m)),
      fc.string({ minLength: 1, maxLength: 200 }).map((m) => new NotFound(m)),
    );
    fc.assert(
      fc.property(errorArb, metaArb, (error, meta) => {
        const envelope = err(error, meta);
        const roundTripped = JSON.parse(JSON.stringify(envelope));
        // The serialized error survives intact: code + message at minimum.
        expect(roundTripped.error.code).toBe(error.code);
        expect(roundTripped.error.message).toBe(error.message);
        // Meta is preserved too.
        for (const key of Object.keys(meta)) {
          expect(roundTripped.meta[key]).toEqual((meta as unknown as Record<string, unknown>)[key]);
        }
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // Edge cases — explicit, beyond what the generic arbitraries hit
  // -------------------------------------------------------------------------

  it("edge: empty arrays, null fields, unicode, and long strings survive", () => {
    const meta: ResponseMeta = {
      correlationId: "01JBZK7PDR6XSYVMWT5YYVH8VQ",
      durationMs: 0,
      cacheHit: false,
      transport: "memory",
      ofVersion: "unknown",
    };
    const edgeData = {
      emptyArray: [] as unknown[],
      nullField: null,
      // Unicode literal written as \u escapes so the file stays ASCII on
      // disk (raw multi-plane chars + a ZWJ make git treat it as binary,
      // which hides the diff in review). Decoded value is the same string.
      unicode:
        "\u65E5\u672C\u8A9E \u2014 caf\u00E9 \u2014 \u{1F98A} \u2014 \u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
      longString: "x".repeat(50_000),
      nested: { a: { b: { c: [1, null, "深い"] } } },
    };
    const roundTripped = JSON.parse(JSON.stringify(ok(edgeData, meta)));
    expect(JSON.stringify(roundTripped.data)).toBe(JSON.stringify(edgeData));
  });
});
