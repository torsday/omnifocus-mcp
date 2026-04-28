/**
 * `perspective_create` MCP tool — create a new custom OmniFocus perspective.
 *
 * Slice B of #577 — pairs with `perspective_get` (#523/#569 read) and
 * `perspective_delete` (#523/#569 destroy) to give agents the full custom-
 * perspective CRUD surface (sans update, which lands separately in #618).
 *
 * The OmniJS script handles the JXA-make + rule-configure + atomic-rollback
 * dance internally so the rollback contract stays inside a single transport
 * hop. See `src/scripts/omnijs/perspective_create.js`.
 *
 * Slice A (#619 / merged) provides the input-side rule schema this tool
 * uses to validate `rules` and `iconColor` before reaching the adapter.
 *
 * @see #577, #617
 * @see src/domain/perspectiveRules.ts — input schema
 * @see src/scripts/omnijs/perspective_create.js — OmniJS implementation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import {
  type PerspectiveAggregation,
  PerspectiveRuleInputSchema,
} from "../../domain/perspectiveRules.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_CREATE_DESCRIPTION =
  "Create a new custom OmniFocus perspective with the given name, optional rule tree, optional aggregation, and optional icon color. " +
  "The shell is created via JXA `make` (the only supported create path) and rules + aggregation + iconColor are written via OmniJS in the same transport hop — if rule writing throws, the shell is rolled back so the database is never left with a half-configured perspective. " +
  "Use BEFORE composing complex authoring flows: pair with `perspective_get` to clone an existing perspective, or with `perspective_delete` to replace one. " +
  "Do NOT use to update an existing perspective — prefer `perspective_update` (slice C) when it lands. " +
  "rules is the same shape `perspective_get` returns (atom | aggregate | disabled wrapper) — round-trips are lossless. " +
  "Each rule atom may set at most one action* predicate; combine predicates by wrapping atoms in a RuleAggregate with aggregateType all/any/none. Tag-id and focus-id arrays must be non-empty with non-empty entries. " +
  "Returns { id } — the persistent identifier of the new custom perspective. " +
  "Side effects: creates a perspective in OmniFocus; invalidates the perspective cache; sets meta.syncPending = true. " +
  "Custom perspectives require OmniFocus Pro — without it, the adapter throws FeatureRequiresPro. " +
  'Example: perspective_create({ name: "Today\'s plate", aggregation: "all", rules: [{ actionStatus: "flagged" }] })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const PerspectiveAggregationInputSchema: z.ZodType<PerspectiveAggregation> = z.enum([
  "all",
  "any",
  "none",
]);

const PerspectiveIconColorInputSchema = z
  .object({
    r: z.number().min(0).max(1).describe("Red channel as a [0, 1] float."),
    g: z.number().min(0).max(1).describe("Green channel as a [0, 1] float."),
    b: z.number().min(0).max(1).describe("Blue channel as a [0, 1] float."),
    a: z.number().min(0).max(1).describe("Alpha channel as a [0, 1] float; 1 is opaque."),
  })
  .strict();

export const perspectiveCreateInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Display name for the new perspective. Must be non-empty and unique within the OmniFocus database — duplicate names are rejected with VALIDATION_ERROR.",
    ),
  aggregation: PerspectiveAggregationInputSchema.optional().describe(
    'Top-level rule aggregation. One of "all", "any", "none". Defaults to "all" when omitted.',
  ),
  rules: z
    .array(PerspectiveRuleInputSchema)
    .optional()
    .describe(
      "Top-level rule list. Empty array means 'show everything' (the default for fresh perspectives). Each rule is an atom (single action* predicate), an aggregate (compound rule with aggregateType + aggregateRules), or a disabled wrapper around either.",
    ),
  iconColor: PerspectiveIconColorInputSchema.optional().describe(
    "Custom icon color in [0, 1] floats { r, g, b, a }. Omit for the OmniFocus-assigned default.",
  ),
});

export type PerspectiveCreateToolInput = z.infer<typeof perspectiveCreateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface PerspectiveCreateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Optional cache; when supplied, invalidates the perspective scope on success. */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `perspective_create`.
 *
 * @throws FeatureRequiresPro — when the OmniFocus edition lacks the
 *         custom-perspective runtime.
 * @throws ValidationError — duplicate name, or other OmniFocus-side rejection.
 * @throws ScriptError — the shell was created but configure failed AND
 *         rollback also failed (rare; both messages are surfaced).
 */
export async function handleperspectiveCreate(
  input: PerspectiveCreateToolInput,
  ctx: PerspectiveCreateContext,
) {
  const id = await ctx.adapter.createCustomPerspective({
    name: input.name,
    ...(input.aggregation !== undefined && { aggregation: input.aggregation }),
    ...(input.rules !== undefined && { rules: input.rules }),
    ...(input.iconColor !== undefined && { iconColor: input.iconColor }),
  });

  // Invalidate the perspective scope so listPerspectives / perspective_get
  // do not return stale results immediately after the create.
  if (ctx.cache !== undefined) {
    ctx.cache.invalidate("perspective:*");
  }

  return ok(
    { id, name: input.name },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: `Created custom perspective "${input.name}".`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerspectiveCreateTool(server: McpServer, ctx: PerspectiveCreateContext) {
  return server.registerTool(
    "perspective_create",
    {
      description: PERSPECTIVE_CREATE_DESCRIPTION,
      inputSchema: perspectiveCreateInputSchema.shape,
    },
    async (args: PerspectiveCreateToolInput) => {
      const envelope = await handleperspectiveCreate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
