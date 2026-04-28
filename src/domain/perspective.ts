/**
 * Zod schemas and TypeScript types for the Perspective domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Perspectives are either built-in (Inbox, Projects, Tags, Forecast,
 * Flagged, Nearby, Review) or custom (OmniJS + OmniFocus Pro).
 *
 * Note: `id` is a plain `string` (not a branded ID) because built-in
 * perspectives use stable well-known names as their IDs, not the opaque
 * UUID-style IDs that tasks/projects/tags carry.
 *
 * @see docs/domain-reference.md — canonical field definitions
 * @see DESIGN.md §13 — ID strategy
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Built-in perspective IDs (stable across OF installs)
// ---------------------------------------------------------------------------

export const BUILTIN_PERSPECTIVE_IDS = [
  "inbox",
  "projects",
  "tags",
  "forecast",
  "flagged",
  "nearby",
  "review",
] as const;

export type BuiltinPerspectiveId = (typeof BUILTIN_PERSPECTIVE_IDS)[number];

// ---------------------------------------------------------------------------
// Perspective
// ---------------------------------------------------------------------------

export interface Perspective {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  /** True for custom perspectives — require OmniFocus Pro */
  requiresPro: boolean;
  /** Emoji or named glyph; metadata only; null when unavailable */
  icon: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const PerspectiveSchema: z.ZodType<Perspective> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["builtin", "custom"]),
  requiresPro: z.boolean(),
  icon: z.string().nullable(),
}) as z.ZodType<Perspective>;

// ---------------------------------------------------------------------------
// PerspectiveDetail — full configuration of a custom perspective
// ---------------------------------------------------------------------------
//
// Returned by `perspective_get` for `kind: "custom"` perspectives. Built-in
// perspectives have no rule tree — `perspective_get` errors on them. The
// rule schema mirrors what OmniFocus exposes via
// `Perspective.Custom.archivedFilterRules`. Atom keys observed on real
// databases are typed; unknown keys are preserved verbatim under
// `unknown` so a future OF release exposing a new rule type doesn't
// silently drop data.
//
// @see #523 — investigation results
// @see docs/domain-reference.md — Perspective schema

/** Top-level aggregation across rule atoms. */
export type PerspectiveAggregation = "all" | "any" | "none";

export interface PerspectiveRuleAtom {
  /** Restrict by action lifecycle status. */
  actionAvailability?: "available" | "remaining" | "completed" | "dropped" | "firstAvailable";
  /** Restrict by specific status flag. */
  actionStatus?: "flagged" | "due";
  /** Tag-id list — task must carry every tag in the list. */
  actionHasAllOfTags?: string[];
  /** Tag-id list — task must carry at least one tag in the list. */
  actionHasAnyOfTags?: string[];
  /** Inbox-style filter (no project). */
  actionHasNoProject?: boolean;
  /** Restrict to tasks with (or without) a due date. */
  actionHasDueDate?: boolean;
  /** Restrict to tasks with (or without) a defer date. */
  actionHasDeferDate?: boolean;
  /** Restrict to tasks with no children. */
  actionIsLeaf?: boolean;
  /** Restrict to project-equivalent items. */
  actionIsProject?: boolean;
  /** Substring search across name + note. */
  actionMatchingSearch?: string[];
  /** Project/folder-id list — restrict to descendants of these containers. */
  actionWithinFocus?: string[];
  /** Forward-compatibility carrier: keys not yet in this type are placed here verbatim. */
  unknown?: Record<string, unknown>;
}

/** Compound rule combining children with `all` / `any` / `none` logic. */
export interface PerspectiveRuleAggregate {
  aggregateType: PerspectiveAggregation;
  aggregateRules: PerspectiveRule[];
}

/** Wrapper that disables a rule without removing it from the tree. */
export interface PerspectiveRuleDisabled {
  disabledRule: PerspectiveRule;
}

export type PerspectiveRule =
  | PerspectiveRuleAtom
  | PerspectiveRuleAggregate
  | PerspectiveRuleDisabled;

/** RGBA in [0, 1] floats. Null when the perspective has no custom color. */
export interface PerspectiveIconColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PerspectiveDetail {
  id: string;
  name: string;
  /** Top-level rule aggregation; defaults to `"all"` when null on disk. */
  aggregation: PerspectiveAggregation;
  /** Top-level rule list. Empty array means "show everything". */
  rules: PerspectiveRule[];
  /** Custom icon color when set, else null. */
  iconColor: PerspectiveIconColor | null;
}

const PerspectiveAggregationSchema = z.enum(["all", "any", "none"]);

const PerspectiveRuleAtomSchema = z.object({
  actionAvailability: z
    .enum(["available", "remaining", "completed", "dropped", "firstAvailable"])
    .optional(),
  actionStatus: z.enum(["flagged", "due"]).optional(),
  actionHasAllOfTags: z.array(z.string()).optional(),
  actionHasAnyOfTags: z.array(z.string()).optional(),
  actionHasNoProject: z.boolean().optional(),
  actionHasDueDate: z.boolean().optional(),
  actionHasDeferDate: z.boolean().optional(),
  actionIsLeaf: z.boolean().optional(),
  actionIsProject: z.boolean().optional(),
  actionMatchingSearch: z.array(z.string()).optional(),
  actionWithinFocus: z.array(z.string()).optional(),
  unknown: z.record(z.string(), z.unknown()).optional(),
}) as unknown as z.ZodType<PerspectiveRuleAtom>;

export const PerspectiveRuleSchema: z.ZodType<PerspectiveRule> = z.lazy(() =>
  z.union([
    z.object({
      aggregateType: PerspectiveAggregationSchema,
      aggregateRules: z.array(PerspectiveRuleSchema),
    }),
    z.object({ disabledRule: PerspectiveRuleSchema }),
    PerspectiveRuleAtomSchema,
  ]),
);

export const PerspectiveIconColorSchema: z.ZodType<PerspectiveIconColor> = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1),
});

export const PerspectiveDetailSchema: z.ZodType<PerspectiveDetail> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aggregation: PerspectiveAggregationSchema,
  rules: z.array(PerspectiveRuleSchema),
  iconColor: PerspectiveIconColorSchema.nullable(),
});
