/**
 * Tests for Unicode-safe string helpers (#834).
 *
 * The core invariant under test: truncation never splits a UTF-16 surrogate
 * pair, so the result is always valid Unicode (no lone surrogate / `�`). The
 * fixtures cover the categories the audit called out: emoji (astral plane),
 * ZWJ sequences, CJK, and combining accents.
 *
 * @see src/domain/text.ts
 */

import { describe, expect, it } from "vitest";
import { codePointLength, ELLIPSIS, truncateCodePoints, truncateWithEllipsis } from "./text.js";

// Fixtures (written as \u escapes so the source file stays ASCII on disk —
// raw multi-plane chars + a ZWJ make git treat the file as binary).
const FOX = "\u{1F98A}"; // fox — single astral code point, 2 UTF-16 units
const CJK = "\u4E2D\u6587"; // CJK "Chinese"
const CAFE_NFC = "caf\u00E9"; // cafe with precomposed e-acute (NFC)
const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // family ZWJ sequence

/** A string has no lone surrogate iff re-encoding round-trips losslessly. */
function isWellFormed(s: string): boolean {
  // String#isWellFormed (ES2024) is available on Node 20+; fall back to a
  // regex for lone surrogates if absent.
  if (typeof (s as { isWellFormed?: () => boolean }).isWellFormed === "function") {
    return (s as unknown as { isWellFormed(): boolean }).isWellFormed();
  }
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

describe("codePointLength", () => {
  it("counts code points, not UTF-16 code units", () => {
    expect(FOX.length).toBe(2); // sanity: UTF-16 units
    expect(codePointLength(FOX)).toBe(1);
    expect(codePointLength(CJK)).toBe(2);
    expect(codePointLength("ascii")).toBe(5);
    expect(codePointLength("")).toBe(0);
  });
});

describe("truncateCodePoints", () => {
  it("returns the input unchanged when within budget", () => {
    expect(truncateCodePoints(CJK, 5)).toBe(CJK);
    expect(truncateCodePoints("ascii", 5)).toBe("ascii");
  });

  it("never splits a surrogate pair at the boundary", () => {
    // "🦊🦊🦊" is 6 UTF-16 units / 3 code points. A naive .slice(0, 3) would
    // cut the second fox in half. We cut on code points instead.
    const foxes = FOX.repeat(3);
    const out = truncateCodePoints(foxes, 2);
    expect(codePointLength(out)).toBe(2);
    expect(out).toBe(FOX.repeat(2));
    expect(isWellFormed(out)).toBe(true);
  });

  it("handles max <= 0 as empty", () => {
    expect(truncateCodePoints("anything", 0)).toBe("");
    expect(truncateCodePoints("anything", -3)).toBe("");
  });

  it("keeps a multibyte char whole at exactly the boundary", () => {
    const mixed = `ab${FOX}cd`; // a b 🦊 c d — 5 code points
    expect(truncateCodePoints(mixed, 3)).toBe(`ab${FOX}`);
    expect(isWellFormed(truncateCodePoints(mixed, 3))).toBe(true);
  });
});

describe("truncateWithEllipsis", () => {
  it("returns the input unchanged when within budget", () => {
    expect(truncateWithEllipsis("short", 10)).toBe("short");
    expect(truncateWithEllipsis(CAFE_NFC, 10)).toBe(CAFE_NFC);
  });

  it("appends an ellipsis and stays within the code-point budget", () => {
    const out = truncateWithEllipsis("a".repeat(150), 140);
    expect(codePointLength(out)).toBe(140);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
  });

  it("never splits a surrogate pair, even with the ellipsis reservation", () => {
    const foxes = FOX.repeat(10); // 10 code points
    const out = truncateWithEllipsis(foxes, 4); // 3 foxes + …
    expect(out).toBe(`${FOX.repeat(3)}${ELLIPSIS}`);
    expect(codePointLength(out)).toBe(4);
    expect(isWellFormed(out)).toBe(true);
  });

  it("cuts a ZWJ emoji sequence without producing a lone surrogate", () => {
    // Code-point safety is the contract — the family glyph may break into its
    // component people, but the result must still be well-formed Unicode.
    const out = truncateWithEllipsis(`${FAMILY}${FAMILY}`, 4);
    expect(isWellFormed(out)).toBe(true);
    expect(codePointLength(out)).toBe(4);
  });
});
