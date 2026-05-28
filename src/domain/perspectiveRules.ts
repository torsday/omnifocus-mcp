/**
 * Strict *input* schema for custom-perspective rule trees, used by
 * `perspective_create` and `perspective_update` (#577).
 *
 * Why a separate module from `perspective.ts`:
 * - `perspective.ts` defines the **output** schemas used by `perspective_get`
 *   and the OmniJS read-side serialization (#523/#569). Output is permissive:
 *   it tolerates `unknown` carrier keys for forward compatibility and accepts
 *   atoms that combine multiple action* predicates (because OmniFocus on disk
 *   may emit those combinations even when the agent shouldn't author them).
 * - This module defines the **input** schema. Input is stricter:
 *   - Atom-key disjointness refinement: an atom may set **at most one** of
 *     the action* predicates. Use a `RuleAggregate` with `aggregateType: "all"`
 *     to AND multiple predicates — that's the canonical authoring shape and
 *     it round-trips through OmniJS without surprises.
 *   - Tag-id and focus-id arrays must be non-empty, and each entry must be a
 *     non-empty string. An empty list is a degenerate filter that OmniFocus
 *     evaluates inconsistently across versions; reject it at the boundary.
 *   - No `unknown` carrier key. Forward compatibility is a read concern;
 *     letting the agent write arbitrary keys breaks the schema contract.
 *
 * The TypeScript *types* (`PerspectiveRule`, `PerspectiveRuleAtom`,
 * `PerspectiveRuleAggregate`, `PerspectiveRuleDisabled`) are reused as-is from
 * `perspective.ts`. Only the runtime validation differs.
 *
 * @see #577 — perspective_create + perspective_update
 * @see src/domain/perspective.ts — output-side schemas (PerspectiveRuleSchema)
 */

import { z } from "zod";
import type {
  PerspectiveAggregation,
  PerspectiveRule,
  PerspectiveRuleAggregate,
  PerspectiveRuleAtom,
  PerspectiveRuleDisabled,
} from "./perspective.js";

// ---------------------------------------------------------------------------
// Action-key inventory — single source of truth for the disjointness refine.
// ---------------------------------------------------------------------------

/**
 * Every key on `PerspectiveRuleAtom` that represents an action predicate.
 * Listed explicitly (rather than computed from `keyof`) so adding a new
 * predicate forces an intentional update of the disjointness rule.
 */
export const ACTION_KEYS = [
  "actionAvailability",
  "actionStatus",
  "actionHasAllOfTags",
  "actionHasAnyOfTags",
  "actionHasNoProject",
  "actionHasDueDate",
  "actionHasDeferDate",
  "actionIsLeaf",
  "actionIsProject",
  "actionMatchingSearch",
  "actionWithinFocus",
] as const satisfies readonly (keyof PerspectiveRuleAtom)[];

/**
 * Returns the count of action-predicate keys actually set on an atom.
 * Used by the disjointness refinement and by tests so the same definition of
 * "set" applies in both places.
 */
export function countActionKeys(atom: PerspectiveRuleAtom): number {
  let n = 0;
  for (const k of ACTION_KEYS) {
    if (atom[k] !== undefined) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Atom field schemas
// ---------------------------------------------------------------------------

/**
 * Non-empty string-id list. Each entry must itself be a non-empty string —
 * a bare `""` would silently match no records, and empty arrays are
 * inconsistently evaluated across OmniFocus versions.
 */
const NonEmptyIdList = z
  .array(z.string().min(1, "id must be non-empty"))
  .min(1, "list must contain at least one id");

const AggregationInputSchema = z.enum(["all", "any", "none"]);

// ---------------------------------------------------------------------------
// Atom input schema
// ---------------------------------------------------------------------------

/**
 * Base atom — every action predicate is optional. The disjointness rule is
 * applied as a `.superRefine` below so violations carry a precise path.
 *
 * `.strict()` rejects unknown keys — agents can't smuggle `unknown` carrier
 * data into a write payload.
 */
const PerspectiveRuleAtomBaseSchema = z
  .object({
    actionAvailability: z
      .enum(["available", "remaining", "completed", "dropped", "firstAvailable"])
      .optional(),
    actionStatus: z.enum(["flagged", "due"]).optional(),
    actionHasAllOfTags: NonEmptyIdList.optional(),
    actionHasAnyOfTags: NonEmptyIdList.optional(),
    actionHasNoProject: z.boolean().optional(),
    actionHasDueDate: z.boolean().optional(),
    actionHasDeferDate: z.boolean().optional(),
    actionIsLeaf: z.boolean().optional(),
    actionIsProject: z.boolean().optional(),
    actionMatchingSearch: z.array(z.string().min(1)).min(1).optional(),
    actionWithinFocus: NonEmptyIdList.optional(),
  })
  .strict();

export const PerspectiveRuleAtomInputSchema: z.ZodType<PerspectiveRuleAtom> =
  PerspectiveRuleAtomBaseSchema.superRefine((atom, ctx) => {
    const count = countActionKeys(atom as PerspectiveRuleAtom);
    if (count > 1) {
      const setKeys = ACTION_KEYS.filter((k) => (atom as PerspectiveRuleAtom)[k] !== undefined);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Rule atom must set at most one action predicate; got ${count} (${setKeys.join(", ")}). ` +
          "Combine predicates by wrapping atoms in a RuleAggregate with " +
          'aggregateType: "all" / "any" / "none" instead.',
        path: [],
      });
    }
  }) as z.ZodType<PerspectiveRuleAtom>;

// ---------------------------------------------------------------------------
// Recursive rule input schema
// ---------------------------------------------------------------------------

/**
 * Recursive discriminated union: `RuleAtom | RuleAggregate | RuleDisabled`.
 *
 * The atom branch goes last in the union so Zod tries the structurally
 * distinctive branches (`aggregateType` for aggregate, `disabledRule` for
 * disabled) first. Without that ordering, an atom with no action keys would
 * also match the empty aggregate shape and produce confusing errors.
 */
export const PerspectiveRuleInputSchema: z.ZodType<PerspectiveRule> = z.lazy(() =>
  z.union([
    z
      .object({
        aggregateType: AggregationInputSchema,
        aggregateRules: z.array(PerspectiveRuleInputSchema),
      })
      .strict() as z.ZodType<PerspectiveRuleAggregate>,
    z
      .object({ disabledRule: PerspectiveRuleInputSchema })
      .strict() as z.ZodType<PerspectiveRuleDisabled>,
    PerspectiveRuleAtomInputSchema,
  ]),
);

// Recursive schemas must be registered with a stable id so Zod's
// `toJSONSchema` (used by the MCP SDK for `tools/list`) emits a `$ref`
// into `$defs` instead of inlining and recursing forever. Without this,
// `tools/list` overflows the stack the first time a client calls it (#717).
PerspectiveRuleInputSchema.register(z.globalRegistry, { id: "PerspectiveRuleInput" });

// Re-export the aggregation type so callers writing input payloads do not
// need to import from both modules.
export type { PerspectiveAggregation };
