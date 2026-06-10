/**
 * Unit tests for the repetition grammar.
 *
 * Fixture-driven — `OK_FIXTURES` covers the primary supported patterns,
 * `AMBIGUOUS_FIXTURES` covers prose with multiple valid readings, and
 * `ERROR_FIXTURES` covers the failure modes. Adding a pattern to the
 * grammar means adding a fixture here.
 */

import { describe, expect, it } from "vitest";

import { parseRepetitionFromProse } from "./repetitionGrammar.js";
import type { RepetitionRule } from "./task.js";

// ---------------------------------------------------------------------------
// OK fixtures — exact rule + description match
// ---------------------------------------------------------------------------

interface OkFixture {
  prose: string;
  rule: RepetitionRule;
  description: string;
}

const OK_FIXTURES: readonly OkFixture[] = [
  // Single-word frequencies
  {
    prose: "daily",
    rule: { method: "fixed", unit: "days", steps: 1 },
    description: "every day",
  },
  {
    prose: "weekly",
    rule: { method: "fixed", unit: "weeks", steps: 1 },
    description: "every week",
  },
  {
    prose: "monthly",
    rule: { method: "fixed", unit: "months", steps: 1 },
    description: "every month",
  },
  {
    prose: "yearly",
    rule: { method: "fixed", unit: "years", steps: 1 },
    description: "every year",
  },
  {
    prose: "annually",
    rule: { method: "fixed", unit: "years", steps: 1 },
    description: "every year",
  },
  {
    prose: "biweekly",
    rule: { method: "fixed", unit: "weeks", steps: 2 },
    description: "every 2 weeks",
  },
  {
    prose: "fortnightly",
    rule: { method: "fixed", unit: "weeks", steps: 2 },
    description: "every 2 weeks",
  },
  {
    prose: "bimonthly",
    rule: { method: "fixed", unit: "months", steps: 2 },
    description: "every 2 months",
  },

  // every-N-{unit}
  {
    prose: "every 3 days",
    rule: { method: "fixed", unit: "days", steps: 3 },
    description: "every 3 days",
  },
  {
    prose: "every two weeks",
    rule: { method: "fixed", unit: "weeks", steps: 2 },
    description: "every 2 weeks",
  },
  {
    prose: "every 6 months",
    rule: { method: "fixed", unit: "months", steps: 6 },
    description: "every 6 months",
  },
  {
    prose: "every 4 hours",
    rule: { method: "fixed", unit: "hours", steps: 4 },
    description: "every 4 hours",
  },

  // every-other-{unit} (single unit, not weekday — that's ambiguous)
  {
    prose: "every other week",
    rule: { method: "fixed", unit: "weeks", steps: 2 },
    description: "every 2 weeks",
  },

  // Bare every-{unit} — implicit count of 1 (the grammar's own canonical
  // steps=1 description, so these must parse for round-trips to hold)
  {
    prose: "every day",
    rule: { method: "fixed", unit: "days", steps: 1 },
    description: "every day",
  },
  {
    prose: "every week",
    rule: { method: "fixed", unit: "weeks", steps: 1 },
    description: "every week",
  },
  {
    prose: "every month",
    rule: { method: "fixed", unit: "months", steps: 1 },
    description: "every month",
  },
  {
    prose: "every year",
    rule: { method: "fixed", unit: "years", steps: 1 },
    description: "every year",
  },
  {
    prose: "every hour",
    rule: { method: "fixed", unit: "hours", steps: 1 },
    description: "every hour",
  },
  {
    prose: "every day at 9am",
    rule: { method: "fixed", unit: "days", steps: 1 },
    description: "every day, at 9am",
  },

  // Weekday selection
  {
    prose: "every Monday",
    rule: { method: "fixed", unit: "weeks", steps: 1, weekdays: ["monday"] },
    description: "every Monday",
  },
  {
    prose: "every Mon",
    rule: { method: "fixed", unit: "weeks", steps: 1, weekdays: ["monday"] },
    description: "every Monday",
  },
  {
    prose: "every Mon, Wed, Fri",
    rule: {
      method: "fixed",
      unit: "weeks",
      steps: 1,
      weekdays: ["monday", "wednesday", "friday"],
    },
    description: "every Monday, Wednesday, and Friday",
  },
  {
    prose: "every Tuesday and Thursday",
    rule: {
      method: "fixed",
      unit: "weeks",
      steps: 1,
      weekdays: ["tuesday", "thursday"],
    },
    description: "every Tuesday and Thursday",
  },
  {
    prose: "every weekday",
    rule: {
      method: "fixed",
      unit: "weeks",
      steps: 1,
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    },
    description: "every weekday",
  },
  {
    prose: "every weekend",
    rule: {
      method: "fixed",
      unit: "weeks",
      steps: 1,
      weekdays: ["sunday", "saturday"],
    },
    description: "every weekend",
  },

  // Nth-of-month, weekday-position
  {
    prose: "the first Monday of every month",
    rule: {
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { weekday: "monday", position: 1 },
    },
    description: "the first Monday of every month",
  },
  {
    prose: "the third Tuesday of each month",
    rule: {
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { weekday: "tuesday", position: 3 },
    },
    description: "the third Tuesday of every month",
  },
  {
    prose: "the last Friday of every month",
    rule: {
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { weekday: "friday", position: "last" },
    },
    description: "the last Friday of every month",
  },

  // Day-of-month
  {
    prose: "the 15 of every month",
    rule: {
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { day: 15 },
    },
    description: "the 15 of every month",
  },
  {
    prose: "the 1st of every month",
    rule: {
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { day: 1 },
    },
    description: "the 1 of every month",
  },

  // Completion-relative method
  {
    prose: "every 3 days after I complete it",
    rule: { method: "start-again", unit: "days", steps: 3 },
    description: "every 3 days, after I complete it",
  },
  {
    prose: "weekly after completion",
    rule: { method: "start-again", unit: "weeks", steps: 1 },
    description: "every week, after I complete it",
  },
  {
    prose: "monthly from the due date",
    rule: { method: "due-again", unit: "months", steps: 1 },
    description: "every month, from the due date",
  },

  // Time-of-day and end-conditions surface as advisory text
  {
    prose: "every Monday at 9am",
    rule: { method: "fixed", unit: "weeks", steps: 1, weekdays: ["monday"] },
    description: "every Monday, at 9am",
  },
  {
    prose: "every weekday at 09:30",
    rule: {
      method: "fixed",
      unit: "weeks",
      steps: 1,
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    },
    description: "every weekday, at 09:30",
  },
  {
    prose: "weekly for 6 weeks",
    rule: { method: "fixed", unit: "weeks", steps: 1 },
    description: "every week, for 6 weeks",
  },
  {
    prose: "daily until 2026-12-31",
    rule: { method: "fixed", unit: "days", steps: 1 },
    description: "every day, until 2026-12-31",
  },
];

describe("parseRepetitionFromProse — ok fixtures", () => {
  for (const fixture of OK_FIXTURES) {
    it(`parses '${fixture.prose}'`, () => {
      const result = parseRepetitionFromProse(fixture.prose);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.rule).toEqual(fixture.rule);
      expect(result.normalizedDescription).toBe(fixture.description);
    });
  }
});

// ---------------------------------------------------------------------------
// Ambiguous fixtures
// ---------------------------------------------------------------------------

describe("parseRepetitionFromProse — ambiguous fixtures", () => {
  it("'every other Tuesday' returns 2 interpretations", () => {
    const result = parseRepetitionFromProse("every other Tuesday");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.interpretations).toHaveLength(2);

    // Interpretation 1: every 2 weeks on Tuesday
    expect(result.interpretations[0]?.rule).toEqual({
      method: "fixed",
      unit: "weeks",
      steps: 2,
      weekdays: ["tuesday"],
    });
    // Interpretation 2: monthly anchored on the first Tuesday (closest schema fit)
    expect(result.interpretations[1]?.rule).toEqual({
      method: "fixed",
      unit: "months",
      steps: 1,
      monthlyAnchor: { weekday: "tuesday", position: 1 },
    });
  });

  it("'every other Monday after I complete it' propagates method to both readings", () => {
    const result = parseRepetitionFromProse("every other Monday after I complete it");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.interpretations).toHaveLength(2);
    expect(result.interpretations[0]?.rule.method).toBe("start-again");
    expect(result.interpretations[1]?.rule.method).toBe("start-again");
  });

  it("each interpretation has a non-empty description", () => {
    const result = parseRepetitionFromProse("every other Friday");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    for (const interp of result.interpretations) {
      expect(interp.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Error fixtures
// ---------------------------------------------------------------------------

describe("parseRepetitionFromProse — error fixtures", () => {
  it("returns no-repetition-detected for empty input", () => {
    const result = parseRepetitionFromProse("");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reason).toBe("no-repetition-detected");
  });

  it("returns no-repetition-detected for whitespace-only input", () => {
    const result = parseRepetitionFromProse("   \n  ");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reason).toBe("no-repetition-detected");
  });

  it("returns no-repetition-detected for prose with no recognized cadence", () => {
    const result = parseRepetitionFromProse("buy milk on the way home");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.reason).toBe("no-repetition-detected");
    expect(result.suggestion).toBeDefined();
  });

  it("includes a suggestion when no pattern matches", () => {
    const result = parseRepetitionFromProse("kind of often");
    if (result.kind !== "error") {
      expect.fail("expected error for unrecognized prose");
      return;
    }
    expect(result.suggestion).toContain("every");
  });
});

// ---------------------------------------------------------------------------
// Robustness — case, whitespace, punctuation
// ---------------------------------------------------------------------------

describe("parseRepetitionFromProse — robustness", () => {
  it("is case-insensitive", () => {
    const a = parseRepetitionFromProse("Every Monday");
    const b = parseRepetitionFromProse("every monday");
    expect(a).toEqual(b);
  });

  it("collapses internal whitespace", () => {
    const a = parseRepetitionFromProse("every    Monday");
    const b = parseRepetitionFromProse("every Monday");
    expect(a).toEqual(b);
  });

  it("trims surrounding whitespace", () => {
    const a = parseRepetitionFromProse("  weekly  ");
    const b = parseRepetitionFromProse("weekly");
    expect(a).toEqual(b);
  });

  it("de-duplicates repeated weekday tokens", () => {
    const result = parseRepetitionFromProse("every Monday and Monday");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.rule.weekdays).toEqual(["monday"]);
  });

  it("orders weekdays Sunday-first regardless of input order", () => {
    const result = parseRepetitionFromProse("every Friday and Monday");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.rule.weekdays).toEqual(["monday", "friday"]);
  });
});

// ---------------------------------------------------------------------------
// Schema compatibility — every produced rule validates against
// RepetitionRuleSchema. This is the load-bearing assertion that the grammar
// can't drift away from the canonical type.
// ---------------------------------------------------------------------------

describe("parseRepetitionFromProse — schema compatibility", () => {
  it("every OK fixture's rule validates against RepetitionRuleSchema", async () => {
    const { RepetitionRuleSchema } = await import("./task.js");
    const failures: Array<{ prose: string; issues: unknown }> = [];
    for (const fixture of OK_FIXTURES) {
      const parsed = RepetitionRuleSchema.safeParse(fixture.rule);
      if (!parsed.success) failures.push({ prose: fixture.prose, issues: parsed.error.issues });
    }
    expect(failures).toEqual([]);
  });

  it("every ambiguous-interpretation rule validates against RepetitionRuleSchema", async () => {
    const { RepetitionRuleSchema } = await import("./task.js");
    const result = parseRepetitionFromProse("every other Wednesday");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    for (const interp of result.interpretations) {
      const parsed = RepetitionRuleSchema.safeParse(interp.rule);
      expect(parsed.success).toBe(true);
    }
  });
});
