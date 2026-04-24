/**
 * Unit tests for assertNotModifiedSince.
 *
 * @see src/server/assertNotModifiedSince.ts
 */

import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../errors/index.js";
import { assertNotModifiedSince } from "./assertNotModifiedSince.js";

describe("assertNotModifiedSince", () => {
  it("is a no-op when expected is undefined", () => {
    expect(() =>
      assertNotModifiedSince(undefined, "2026-04-23T12:00:00.000Z", "task:abc"),
    ).not.toThrow();
  });

  it("passes when expected and observed represent the same instant", () => {
    expect(() =>
      assertNotModifiedSince("2026-04-23T12:00:00.000Z", "2026-04-23T12:00:00.000Z", "task:abc"),
    ).not.toThrow();
  });

  it("treats Z and +00:00 suffixes as equivalent", () => {
    expect(() =>
      assertNotModifiedSince(
        "2026-04-23T12:00:00.000Z",
        "2026-04-23T12:00:00.000+00:00",
        "task:abc",
      ),
    ).not.toThrow();
  });

  it("treats equivalent offsets as equivalent", () => {
    expect(() =>
      assertNotModifiedSince(
        "2026-04-23T12:00:00.000Z",
        "2026-04-23T08:00:00.000-04:00",
        "task:abc",
      ),
    ).not.toThrow();
  });

  it("throws ConflictError with details when timestamps differ", () => {
    try {
      assertNotModifiedSince("2026-04-23T12:00:00.000Z", "2026-04-23T12:00:00.001Z", "task:abc");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      const serialized = (err as ConflictError).toJSON();
      expect(serialized.code).toBe("OF_CONFLICT");
      expect(serialized.details).toMatchObject({
        resource: "task:abc",
        expected: "2026-04-23T12:00:00.000Z",
        observed: "2026-04-23T12:00:00.001Z",
      });
    }
  });

  it("throws ValidationError when expected is malformed", () => {
    try {
      assertNotModifiedSince("not-a-date", "2026-04-23T12:00:00.000Z", "task:abc");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("OF_VALIDATION");
    }
  });

  it("throws ValidationError when observed is malformed", () => {
    try {
      assertNotModifiedSince("2026-04-23T12:00:00.000Z", "not-a-date", "task:abc");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });

  it("throws ValidationError on empty string expected (Date.parse returns NaN)", () => {
    expect(() => assertNotModifiedSince("", "2026-04-23T12:00:00.000Z", "task:abc")).toThrow(
      ValidationError,
    );
  });
});
