/**
 * Unit tests for textSimilarity helpers.
 */

import { describe, expect, it } from "vitest";
import {
  type CollisionReason,
  collisionReason,
  jaccard,
  levenshtein,
  normalizeName,
  score,
  tokenize,
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

// ===========================================================================
// Ranking surface — used by task_find_similar
// ===========================================================================

describe("tokenize", () => {
  it("lowercases, splits on non-word, drops short and stop-word tokens", () => {
    expect(tokenize("Call the dentist on Monday")).toEqual(["call", "dentist", "monday"]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns empty array for stop-word-only input", () => {
    expect(tokenize("the and of")).toEqual([]);
  });

  it("preserves digits and apostrophes", () => {
    expect(tokenize("renew taxes 2025 don't forget")).toEqual([
      "renew",
      "taxes",
      "2025",
      "don't",
      "forget",
    ]);
  });

  it("strips punctuation", () => {
    expect(tokenize("Call: dentist; schedule!")).toEqual(["call", "dentist", "schedule"]);
  });
});

describe("jaccard", () => {
  it("returns 1.0 for identical sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("returns intersection / union for partial overlap", () => {
    // A = {x, y, z}, B = {y, z, w} → ∩ = 2, ∪ = 4 → 0.5
    const result = jaccard(new Set(["x", "y", "z"]), new Set(["y", "z", "w"]));
    expect(result).toBeCloseTo(0.5, 5);
  });
});

describe("score", () => {
  it("scores identical title + identical note as 1.0", () => {
    const s = score(
      { name: "Call the dentist", note: "schedule a cleaning" },
      { name: "Call the dentist", note: "schedule a cleaning" },
    );
    expect(s).toBeCloseTo(1, 5);
  });

  it("scores identical normalized title even with case difference as exact-match", () => {
    // case difference → still hits the exact-name boost via normalizeName
    const s = score({ name: "Call dentist" }, { name: "CALL Dentist" });
    expect(s).toBeGreaterThan(0.7); // includes title weight + prefix + exact
  });

  it("ranks shared-token candidates above disjoint ones", () => {
    const reference = { name: "Call the dentist" };
    const candidate = { name: "Call dentist about insurance" };
    const distractor = { name: "Buy groceries" };

    expect(score(reference, candidate)).toBeGreaterThan(score(reference, distractor));
  });

  it("returns 0 when title tokens are entirely disjoint and no notes provided", () => {
    expect(score({ name: "Call dentist" }, { name: "Buy groceries" })).toBe(0);
  });

  it("note overlap contributes when both sides have notes", () => {
    // Same disjoint titles, but matching notes — note score lifts above 0.
    const noNotes = score({ name: "Alpha" }, { name: "Beta" });
    const withNotes = score(
      { name: "Alpha", note: "follow up next week" },
      { name: "Beta", note: "follow up next week" },
    );
    expect(withNotes).toBeGreaterThan(noNotes);
  });

  it("note overlap does not contribute when only one side has a note", () => {
    const oneSided = score({ name: "Alpha", note: "follow up" }, { name: "Beta" });
    expect(oneSided).toBe(0);
  });

  it("title is weighted more heavily than note", () => {
    // Perfect note match, disjoint titles ≤ 0.2 (note weight)
    const noteOnly = score(
      { name: "Apple", note: "shared phrase here" },
      { name: "Banana", note: "shared phrase here" },
    );
    expect(noteOnly).toBeLessThanOrEqual(0.2);

    // Perfect title match (single-word) → 0.7 title + 0.05 prefix + 0.05 exact = 0.8
    const titleOnly = score({ name: "Apple" }, { name: "Apple" });
    expect(titleOnly).toBeGreaterThan(noteOnly);
  });

  it("score is always in [0, 1]", () => {
    // Exhaustive on a small fixture — every pair stays in range
    const inputs = [
      { name: "Call dentist" },
      { name: "Schedule cleaning", note: "long note here that mentions dentist twice dentist" },
      { name: "" },
      { name: "Call dentist", note: "Call dentist" },
    ];
    for (const a of inputs) {
      for (const b of inputs) {
        const s = score(a, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is symmetric: score(a, b) === score(b, a)", () => {
    const a = { name: "Call the dentist", note: "schedule cleaning" };
    const b = { name: "Schedule dental cleaning", note: "call dentist office" };
    expect(score(a, b)).toBeCloseTo(score(b, a), 10);
  });
});
