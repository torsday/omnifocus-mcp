import { describe, expect, it } from "vitest";
import { stableStringify } from "./stableStringify.js";

describe("stableStringify", () => {
  it("sorts top-level object keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("sorts nested object keys at every depth", () => {
    expect(stableStringify({ outer: { y: 1, x: 2 } })).toBe(
      stableStringify({ outer: { x: 2, y: 1 } }),
    );
    expect(stableStringify({ a: { b: { d: 4, c: 3 } } })).toBe(
      stableStringify({ a: { b: { c: 3, d: 4 } } }),
    );
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("distinguishes value changes at any depth", () => {
    expect(stableStringify({ a: { b: 1 } })).not.toBe(stableStringify({ a: { b: 2 } }));
  });

  it("encodes top-level undefined and null distinctly", () => {
    expect(stableStringify(undefined)).toBe("undefined");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).not.toBe(stableStringify(null));
  });

  it("skips undefined-valued keys inside objects (matches JSON.stringify semantics)", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: { b: 1, c: undefined } })).toBe(stableStringify({ a: { b: 1 } }));
  });

  it("round-trips primitives via JSON.stringify", () => {
    expect(stableStringify("hello")).toBe('"hello"');
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify(true)).toBe("true");
  });
});
