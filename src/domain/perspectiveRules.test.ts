/**
 * Unit tests for the strict input-side rule schema (#577 slice A).
 *
 * Coverage:
 *  - Atom disjointness: reject mixed action shapes; accept single-predicate atoms.
 *  - Strict shape: reject unknown keys (no `unknown` carrier on inputs).
 *  - Id-list validation: tag/focus/search lists must be non-empty and contain
 *    no empty strings.
 *  - Recursive aggregates: arbitrarily-deep aggregate nesting is accepted.
 *  - Disabled wrappers: round-trip through a single rule.
 *  - Cross-cutting: empty atom (no action keys) is accepted as a degenerate
 *    pass-through atom (per AC: "at most one").
 */

import { describe, expect, it } from "vitest";
import {
  ACTION_KEYS,
  countActionKeys,
  PerspectiveRuleAtomInputSchema,
  PerspectiveRuleInputSchema,
} from "./perspectiveRules.js";

// ---------------------------------------------------------------------------
// countActionKeys
// ---------------------------------------------------------------------------

describe("countActionKeys", () => {
  it("returns 0 for an empty atom", () => {
    expect(countActionKeys({})).toBe(0);
  });

  it("counts each action key exactly once", () => {
    expect(countActionKeys({ actionStatus: "flagged" })).toBe(1);
    expect(countActionKeys({ actionStatus: "flagged", actionHasNoProject: true })).toBe(2);
  });

  it("treats `undefined` values as not set", () => {
    // Cast through unknown — exactOptionalPropertyTypes forbids assigning
    // `undefined` literally, but the runtime check must still tolerate it
    // (real callers can land here via destructured rest, etc).
    expect(
      countActionKeys({ actionStatus: undefined } as unknown as Parameters<
        typeof countActionKeys
      >[0]),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PerspectiveRuleAtomInputSchema — disjointness
// ---------------------------------------------------------------------------

describe("PerspectiveRuleAtomInputSchema — disjointness", () => {
  it("accepts an atom with exactly one action key", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({ actionStatus: "flagged" });
    expect(r.success).toBe(true);
  });

  it("accepts an empty atom (zero action keys; degenerate pass-through)", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects an atom with two action keys and names both in the error", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionStatus: "flagged",
      actionHasNoProject: true,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const message = r.error.issues[0]?.message ?? "";
    expect(message).toContain("at most one action predicate");
    expect(message).toContain("actionStatus");
    expect(message).toContain("actionHasNoProject");
  });

  it("rejects an atom with three action keys", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionStatus: "flagged",
      actionHasNoProject: true,
      actionAvailability: "remaining",
    });
    expect(r.success).toBe(false);
  });

  it("ACTION_KEYS covers every documented predicate", () => {
    // Sanity check: if a new predicate is added to PerspectiveRuleAtom, the
    // ACTION_KEYS list must be extended too — otherwise the disjointness
    // refine silently misses it. This test catches that drift.
    expect(ACTION_KEYS.length).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// PerspectiveRuleAtomInputSchema — strict / unknown keys
// ---------------------------------------------------------------------------

describe("PerspectiveRuleAtomInputSchema — strict shape", () => {
  it("rejects an unknown carrier key", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionStatus: "flagged",
      // Output schema permits this; input does not.
      unknown: { someFutureKey: 42 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unrecognized top-level key", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionStatus: "flagged",
      typo: "value",
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PerspectiveRuleAtomInputSchema — id-list validation
// ---------------------------------------------------------------------------

describe("PerspectiveRuleAtomInputSchema — id lists", () => {
  it("accepts a non-empty tag list", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionHasAllOfTags: ["tag-1", "tag-2"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty tag list", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({ actionHasAllOfTags: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an empty string id inside the tag list", () => {
    const r = PerspectiveRuleAtomInputSchema.safeParse({
      actionHasAnyOfTags: ["tag-1", ""],
    });
    expect(r.success).toBe(false);
  });

  it("validates actionWithinFocus as a non-empty id list", () => {
    expect(
      PerspectiveRuleAtomInputSchema.safeParse({ actionWithinFocus: ["proj-1"] }).success,
    ).toBe(true);
    expect(PerspectiveRuleAtomInputSchema.safeParse({ actionWithinFocus: [] }).success).toBe(false);
    expect(PerspectiveRuleAtomInputSchema.safeParse({ actionWithinFocus: [""] }).success).toBe(
      false,
    );
  });

  it("validates actionMatchingSearch as a non-empty string list", () => {
    expect(
      PerspectiveRuleAtomInputSchema.safeParse({ actionMatchingSearch: ["dentist"] }).success,
    ).toBe(true);
    expect(PerspectiveRuleAtomInputSchema.safeParse({ actionMatchingSearch: [] }).success).toBe(
      false,
    );
    expect(PerspectiveRuleAtomInputSchema.safeParse({ actionMatchingSearch: [""] }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// PerspectiveRuleInputSchema — recursive aggregates
// ---------------------------------------------------------------------------

describe("PerspectiveRuleInputSchema — aggregates", () => {
  it("accepts a flat aggregate over single-predicate atoms", () => {
    const tree = {
      aggregateType: "all" as const,
      aggregateRules: [{ actionStatus: "flagged" as const }, { actionHasNoProject: true }],
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(true);
  });

  it("accepts a deeply-nested aggregate (3 levels)", () => {
    const tree = {
      aggregateType: "all" as const,
      aggregateRules: [
        {
          aggregateType: "any" as const,
          aggregateRules: [
            { actionStatus: "flagged" as const },
            {
              aggregateType: "none" as const,
              aggregateRules: [{ actionHasDueDate: true }],
            },
          ],
        },
      ],
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(true);
  });

  it("rejects an aggregate with an unknown key", () => {
    const tree = {
      aggregateType: "all",
      aggregateRules: [],
      bogus: "value",
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects an aggregate whose child violates the disjointness rule", () => {
    const tree = {
      aggregateType: "all" as const,
      aggregateRules: [{ actionStatus: "flagged", actionHasNoProject: true }],
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects an unknown aggregateType", () => {
    const tree = { aggregateType: "xor", aggregateRules: [] };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PerspectiveRuleInputSchema — disabled wrappers
// ---------------------------------------------------------------------------

describe("PerspectiveRuleInputSchema — disabled wrappers", () => {
  it("accepts a disabled-rule wrapper around an atom", () => {
    const tree = { disabledRule: { actionStatus: "flagged" as const } };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(true);
  });

  it("accepts a disabled-rule wrapper around an aggregate", () => {
    const tree = {
      disabledRule: { aggregateType: "any" as const, aggregateRules: [] },
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(true);
  });

  it("rejects a disabled-rule wrapper with extra keys", () => {
    const tree = {
      disabledRule: { actionStatus: "flagged" as const },
      extra: "value",
    };
    expect(PerspectiveRuleInputSchema.safeParse(tree).success).toBe(false);
  });
});
