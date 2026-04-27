/**
 * Unit tests for textSimilarity helpers.
 */

import { describe, expect, it } from "vitest";
import {
  type CollisionReason,
  collisionReason,
  levenshtein,
  normalizeName,
  tokenSet,
  tokenSetEqual,
} from "./textSimilarity.js";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });
  it("returns string length when other is empty", () => {
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });
  it("single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });
  it("single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });
  it("single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });
  it("two edits", () => {
    expect(levenshtein("errand", "errands")).toBe(1);
    expect(levenshtein("work", "wrok")).toBe(2);
  });
});

describe("normalizeName", () => {
  it("lowercases", () => {
    expect(normalizeName("Work")).toBe("work");
  });
  it("trims whitespace", () => {
    expect(normalizeName("  home  ")).toBe("home");
  });
  it("collapses internal whitespace", () => {
    expect(normalizeName("pay  invoice")).toBe("pay invoice");
  });
  it("strips leading @", () => {
    expect(normalizeName("@errand")).toBe("errand");
  });
  it("does not strip embedded @", () => {
    expect(normalizeName("email@work")).toBe("email@work");
  });
});

describe("tokenSet / tokenSetEqual", () => {
  it("splits on whitespace", () => {
    expect(tokenSet("pay invoice")).toEqual(["invoice", "pay"]);
  });
  it("splits on hyphens and underscores", () => {
    expect(tokenSet("follow-up")).toEqual(["follow", "up"]);
    expect(tokenSet("follow_up")).toEqual(["follow", "up"]);
  });
  it("order-insensitive equality", () => {
    expect(tokenSetEqual("Pay Invoice", "invoice pay")).toBe(true);
  });
  it("not equal when tokens differ", () => {
    expect(tokenSetEqual("work", "home")).toBe(false);
  });
  it("different lengths are not equal", () => {
    expect(tokenSetEqual("pay invoice", "pay")).toBe(false);
  });
});

describe("collisionReason", () => {
  it("returns null for unrelated names", () => {
    expect(collisionReason("groceries", "finances")).toBeNull();
  });

  it("exact-duplicate for identical strings", () => {
    expect(collisionReason("Work", "Work")).toBe("exact-duplicate");
  });

  it("case-difference for same letters different case", () => {
    expect(collisionReason("Work", "work")).toBe("case-difference");
    expect(collisionReason("@Errand", "@errand")).toBe("case-difference");
  });

  it("plural-singular for trailing s", () => {
    expect(collisionReason("errand", "errands")).toBe("plural-singular");
    expect(collisionReason("errands", "errand")).toBe("plural-singular");
  });

  it("plural-singular for trailing es", () => {
    expect(collisionReason("invoice", "invoices")).toBe("plural-singular");
  });

  it("near-duplicate for Levenshtein ≤ 2", () => {
    expect(collisionReason("Taxes 2025", "2025 Taxes")).toBe("near-duplicate");
    // "home" vs "hom" = 1 edit
    expect(collisionReason("home", "hom")).toBe("near-duplicate");
  });

  it("near-duplicate for token-set equality", () => {
    expect(collisionReason("Pay Invoice", "Invoice Pay")).toBe("near-duplicate");
  });

  it("returns null when distance > 2 and token sets differ", () => {
    expect(collisionReason("groceries", "grocery shopping")).toBeNull();
  });

  // Specificity: case-difference beats plural-singular (lower rank wins)
  it("case-difference takes precedence over near-duplicate", () => {
    const r = collisionReason("Work", "work") satisfies CollisionReason | null;
    expect(r).toBe("case-difference");
  });
});
