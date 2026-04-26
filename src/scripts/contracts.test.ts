/**
 * Unit tests for the pure helper functions in src/scripts/contracts.ts.
 *
 * These are the only script-layer functions testable without the OmniFocus
 * runtime. All other script behaviour is covered by the InMemoryAdapter
 * contract tests and integration tests.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RawBatchScriptResult } from "./contracts.js";
import { isScriptError, mapBatchScriptResult } from "./contracts.js";

// ---------------------------------------------------------------------------
// isScriptError
// ---------------------------------------------------------------------------

describe("isScriptError", () => {
  it("returns true for a well-formed error envelope", () => {
    expect(isScriptError({ error: { code: "NOT_FOUND", message: "x" } })).toBe(true);
  });

  it("returns false for a success shape", () => {
    expect(isScriptError({ id: "abc" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isScriptError(null)).toBe(false);
  });

  it("returns false for a primitive", () => {
    expect(isScriptError("error")).toBe(false);
    expect(isScriptError(42)).toBe(false);
  });

  it("returns false when error field is null", () => {
    expect(isScriptError({ error: null })).toBe(false);
  });

  it("returns false when error field is a string", () => {
    expect(isScriptError({ error: "something went wrong" })).toBe(false);
  });

  it("returns false when error field is absent", () => {
    expect(isScriptError({ code: "NOT_FOUND" })).toBe(false);
  });

  it("property: any object with error: object passes", () => {
    fc.assert(
      fc.property(fc.record({ code: fc.string(), message: fc.string() }), (inner) => {
        expect(isScriptError({ error: inner })).toBe(true);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// mapBatchScriptResult
// ---------------------------------------------------------------------------

describe("mapBatchScriptResult", () => {
  const identity = (s: string) => s;
  const toUpper = (s: string) => s.toUpperCase();

  it("maps succeeded values through the liftId function", () => {
    const raw: RawBatchScriptResult = {
      succeeded: [
        { index: 0, value: "abc" },
        { index: 2, value: "xyz" },
      ],
      failed: [],
    };
    const result = mapBatchScriptResult(raw, toUpper);
    expect(result.succeeded).toEqual([
      { index: 0, value: "ABC" },
      { index: 2, value: "XYZ" },
    ]);
  });

  it("preserves failed items unchanged", () => {
    const raw: RawBatchScriptResult = {
      succeeded: [],
      failed: [
        { index: 1, errorCode: "NOT_FOUND", message: "Task not found" },
        { index: 3, errorCode: "VALIDATION", message: "Invalid input" },
      ],
    };
    const result = mapBatchScriptResult(raw, identity);
    expect(result.failed).toEqual(raw.failed);
  });

  it("preserves index values on succeeded items", () => {
    const raw: RawBatchScriptResult = {
      succeeded: [{ index: 7, value: "id" }],
      failed: [],
    };
    const result = mapBatchScriptResult(raw, identity);
    expect(result.succeeded[0]?.index).toBe(7);
  });

  it("handles a fully-succeeded batch", () => {
    const raw: RawBatchScriptResult = {
      succeeded: [
        { index: 0, value: "a" },
        { index: 1, value: "b" },
      ],
      failed: [],
    };
    const result = mapBatchScriptResult(raw, identity);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  it("handles a fully-failed batch", () => {
    const raw: RawBatchScriptResult = {
      succeeded: [],
      failed: [{ index: 0, errorCode: "NOT_FOUND", message: "gone" }],
    };
    const result = mapBatchScriptResult(raw, identity);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  it("handles an empty batch", () => {
    const raw: RawBatchScriptResult = { succeeded: [], failed: [] };
    const result = mapBatchScriptResult(raw, identity);
    expect(result.succeeded).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it("property: succeeded.length and failed.length are preserved", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ index: fc.nat(), value: fc.string() })),
        fc.array(
          fc.record({
            index: fc.nat(),
            errorCode: fc.string(),
            message: fc.string(),
          }),
        ),
        (succeeded, failed) => {
          const raw: RawBatchScriptResult = { succeeded, failed };
          const result = mapBatchScriptResult(raw, identity);
          expect(result.succeeded).toHaveLength(succeeded.length);
          expect(result.failed).toHaveLength(failed.length);
        },
      ),
    );
  });

  it("property: liftId is applied exactly once per succeeded item", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ index: fc.nat(), value: fc.string() })), (succeeded) => {
        const raw: RawBatchScriptResult = { succeeded, failed: [] };
        let callCount = 0;
        mapBatchScriptResult(raw, (s) => {
          callCount++;
          return s;
        });
        expect(callCount).toBe(succeeded.length);
      }),
    );
  });

  it("property: failed items are reference-equal to the input (not cloned)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            index: fc.nat(),
            errorCode: fc.string(),
            message: fc.string(),
          }),
        ),
        (failed) => {
          const raw: RawBatchScriptResult = { succeeded: [], failed };
          const result = mapBatchScriptResult(raw, identity);
          for (let i = 0; i < failed.length; i++) {
            // biome-ignore lint/style/noNonNullAssertion: bounded by loop condition
            expect(result.failed[i]).toBe(raw.failed[i]!);
          }
        },
      ),
    );
  });
});
