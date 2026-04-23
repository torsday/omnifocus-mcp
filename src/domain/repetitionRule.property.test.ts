/**
 * Property tests for the RepetitionRule schema.
 *
 * `RepetitionRuleSchema` is a Zod discriminated schema. These tests assert:
 *   1. Valid combinations parse successfully.
 *   2. Invalid combinations (e.g. `steps <= 0`, unknown unit) are rejected.
 *   3. The schema is stable: parsing a valid value and re-serializing it
 *      produces an identical object (no coercion side-effects).
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RepetitionRule, Weekday } from "./task.js";
import { RepetitionRuleSchema } from "./task.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const methodArb = fc.constantFrom<RepetitionRule["method"]>("fixed", "start-again", "due-again");

const unitArb = fc.constantFrom<RepetitionRule["unit"]>(
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
);

const weekdayArb = fc.constantFrom<Weekday>(
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
);

/** A valid positive integer steps value. */
const stepsArb = fc.integer({ min: 1, max: 999 });

/** Minimal valid RepetitionRule (no optional weekdays/monthlyAnchor). */
const minimalRuleArb: fc.Arbitrary<RepetitionRule> = fc.record({
  method: methodArb,
  unit: unitArb,
  steps: stepsArb,
});

/** Rule with optional weekdays. */
const ruleWithWeekdaysArb: fc.Arbitrary<RepetitionRule> = fc.record({
  method: methodArb,
  unit: fc.constantFrom<RepetitionRule["unit"]>("weeks"),
  steps: stepsArb,
  weekdays: fc.uniqueArray(weekdayArb, { minLength: 1, maxLength: 7 }),
});

/** Rule with numeric monthlyAnchor. */
const ruleWithMonthlyDayArb: fc.Arbitrary<RepetitionRule> = fc.record({
  method: methodArb,
  unit: fc.constant<RepetitionRule["unit"]>("months"),
  steps: stepsArb,
  monthlyAnchor: fc.record({ day: fc.integer({ min: 1, max: 31 }) }),
});

/** Rule with weekday-position monthlyAnchor. */
const ruleWithMonthlyWeekdayArb: fc.Arbitrary<RepetitionRule> = fc.record({
  method: methodArb,
  unit: fc.constant<RepetitionRule["unit"]>("months"),
  steps: stepsArb,
  monthlyAnchor: fc.record({
    weekday: weekdayArb,
    position: fc.constantFrom<1 | 2 | 3 | 4 | "last">(1, 2, 3, 4, "last"),
  }),
});

/** Union of all valid rule shapes. */
const validRuleArb = fc.oneof(
  minimalRuleArb,
  ruleWithWeekdaysArb,
  ruleWithMonthlyDayArb,
  ruleWithMonthlyWeekdayArb,
);

// ---------------------------------------------------------------------------
// Property tests — valid combinations
// ---------------------------------------------------------------------------

describe("RepetitionRule schema — property tests", () => {
  it("valid rules parse successfully", () => {
    fc.assert(
      fc.property(validRuleArb, (rule) => {
        const result = RepetitionRuleSchema.safeParse(rule);
        expect(result.success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("parsed valid rule equals input (no coercion side-effects on core fields)", () => {
    fc.assert(
      fc.property(minimalRuleArb, (rule) => {
        const parsed = RepetitionRuleSchema.parse(rule);
        expect(parsed.method).toBe(rule.method);
        expect(parsed.unit).toBe(rule.unit);
        expect(parsed.steps).toBe(rule.steps);
      }),
      { numRuns: 200 },
    );
  });

  it("re-parsing an already-parsed rule produces identical output (idempotent)", () => {
    fc.assert(
      fc.property(validRuleArb, (rule) => {
        const first = RepetitionRuleSchema.parse(rule);
        const second = RepetitionRuleSchema.parse(first);
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  // ---------------------------------------------------------------------------
  // Invalid combinations
  // ---------------------------------------------------------------------------

  it("steps <= 0 is rejected", () => {
    fc.assert(
      fc.property(methodArb, unitArb, fc.integer({ min: -100, max: 0 }), (method, unit, steps) => {
        const result = RepetitionRuleSchema.safeParse({ method, unit, steps });
        expect(result.success).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("unknown method is rejected", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1 })
          .filter((s) => !["fixed", "start-again", "due-again"].includes(s)),
        unitArb,
        stepsArb,
        (method, unit, steps) => {
          const result = RepetitionRuleSchema.safeParse({ method, unit, steps });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("unknown unit is rejected", () => {
    fc.assert(
      fc.property(
        methodArb,
        fc
          .string({ minLength: 1 })
          .filter((s) => !["minutes", "hours", "days", "weeks", "months", "years"].includes(s)),
        stepsArb,
        (method, unit, steps) => {
          const result = RepetitionRuleSchema.safeParse({ method, unit, steps });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("missing required fields (method/unit/steps) are rejected", () => {
    fc.assert(
      fc.property(
        fc.record({
          method: fc.option(methodArb, { nil: undefined }),
          unit: fc.option(unitArb, { nil: undefined }),
          steps: fc.option(stepsArb, { nil: undefined }),
        }),
        (partial) => {
          // At least one field is missing
          fc.pre(
            partial.method === undefined ||
              partial.unit === undefined ||
              partial.steps === undefined,
          );
          const result = RepetitionRuleSchema.safeParse(partial);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
