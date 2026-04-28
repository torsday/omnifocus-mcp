/**
 * `perspective_update` MCP tool — partial-patch update of a custom perspective.
 *
 * Slice C of #577 — pairs with `perspective_create` (#617, slice B) and
 * `perspective_get` / `perspective_delete` (read + destroy, #523/#569) to
 * complete the custom-perspective CRUD surface.
 *
 * Patch semantics: only fields present in the input are written. Omitting
 * a field leaves the existing value unchanged. Passing `iconColor: null`
 * clears the custom color back to the OmniFocus default; omitting
 * iconColor leaves it alone. Passing `rules: []` clears the rule tree to
 * "show everything"; omitting rules leaves them alone.
 *
 * Built-in perspective ids are rejected with `ValidationError`, matching
 * the rejection in `perspective_get` / `perspective_delete`.
 *
 * @see #577, #618
 * @see src/domain/perspectiveRules.ts — input rule schema (slice A)
 * @see src/scripts/omnijs/perspective_update.js — OmniJS implementation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import { BUILTIN_PERSPECTIVE_IDS } from "../../domain/perspective.js";
import {
  type PerspectiveAggregation,
  PerspectiveRuleInputSchema,
} from "../../domain/perspectiveRules.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_UPDATE_DESCRIPTION =
  "Partial-patch update of a custom OmniFocus perspective. " +
  "Only fields present in the input are written — omitting a field leaves the existing value unchanged. Passing iconColor: null clears the custom color back to the OmniFocus default; passing rules: [] clears the rule tree to 'show everything'. " +
  "Use to rename a perspective, retune its rule tree, swap the aggregation, or recolor the icon. " +
  "Do NOT use to create a new perspective (prefer `perspective_create`) or to alter built-in perspectives — built-in ids (Inbox, Forecast, Flagged, Projects, Tags, Nearby, Review) are rejected with VALIDATION_ERROR. " +
  "rules is the same shape `perspective_get` returns (atom | aggregate | disabled wrapper) — round-trips are lossless. Each rule atom may set at most one action* predicate; combine predicates by wrapping atoms in a RuleAggregate with aggregateType all/any/none. " +
  "Returns { id } — the persistent identifier of the patched perspective. " +
  "Side effects: writes to OmniFocus; invalidates the perspective cache; sets meta.syncPending = true. " +
  "Custom perspectives require OmniFocus Pro — without it, the adapter throws FeatureRequiresPro. " +
  'Example: perspective_update({ perspectiveId: "abc123", name: "Today\'s plate", aggregation: "all" }) ' +
  'Example: perspective_update({ perspectiveId: "abc123", iconColor: null })';

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

export const perspectiveUpdateInputSchema = z.object({
  perspectiveId: z
    .string()
    .min(1)
    .describe(
      "Persistent identifier of the custom perspective to patch. Get from `perspective_list`. Built-in perspective ids are rejected with VALIDATION_ERROR.",
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "New display name. Must be non-empty when provided. OmniFocus rejects duplicate names.",
    ),
  aggregation: PerspectiveAggregationInputSchema.optional().describe(
    'New top-level rule aggregation. One of "all", "any", "none".',
  ),
  rules: z
    .array(PerspectiveRuleInputSchema)
    .optional()
    .describe(
      "New top-level rule list. Empty array clears the rule tree to 'show everything'. Each rule is an atom (single action* predicate), an aggregate (compound rule with aggregateType + aggregateRules), or a disabled wrapper around either.",
    ),
  iconColor: z
    .union([PerspectiveIconColorInputSchema, z.null()])
    .optional()
    .describe(
      "New custom icon color, or null to clear back to the OmniFocus default. Omit to leave the existing color unchanged.",
    ),
});

export type PerspectiveUpdateToolInput = z.infer<typeof perspectiveUpdateInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface PerspectiveUpdateContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Optional cache; when supplied, invalidates the perspective scope on success. */
  cache?: InvalidatingCache;
}

/**
 * Pure handler for `perspective_update`.
 *
 * @throws ValidationError — built-in perspective id, OR OmniFocus rejects
 *         the patch (e.g. duplicate name, empty name).
 * @throws NotFound — when the identifier does not match a custom perspective.
 * @throws FeatureRequiresPro — when the OmniFocus edition lacks the
 *         custom-perspective runtime.
 */
export async function handlePerspectiveUpdate(
  input: PerspectiveUpdateToolInput,
  ctx: PerspectiveUpdateContext,
) {
  if ((BUILTIN_PERSPECTIVE_IDS as readonly string[]).includes(input.perspectiveId)) {
    throw new ValidationError(
      `Built-in perspectives cannot be updated: ${input.perspectiveId}. Built-in ids: ${BUILTIN_PERSPECTIVE_IDS.join(", ")}.`,
      {
        details: { field: "perspectiveId", id: input.perspectiveId, kind: "builtin" },
        suggestion:
          "Use perspective_list to find a custom perspective id, or call perspective_create to create a new one.",
      },
    );
  }

  await ctx.adapter.updateCustomPerspective(input.perspectiveId, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.aggregation !== undefined && { aggregation: input.aggregation }),
    ...(input.rules !== undefined && { rules: input.rules }),
    ...(input.iconColor !== undefined && { iconColor: input.iconColor }),
  });

  if (ctx.cache !== undefined) {
    ctx.cache.invalidate("perspective:*");
  }

  return ok(
    { id: input.perspectiveId },
    ctx.makeMeta({
      syncPending: true,
      humanReadableSummary: `Updated custom perspective ${input.perspectiveId}.`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerspectiveUpdateTool(server: McpServer, ctx: PerspectiveUpdateContext) {
  return server.registerTool(
    "perspective_update",
    {
      description: PERSPECTIVE_UPDATE_DESCRIPTION,
      inputSchema: perspectiveUpdateInputSchema.shape,
    },
    async (args: PerspectiveUpdateToolInput) => {
      const envelope = await handlePerspectiveUpdate(args, ctx);
      return toolResponse(envelope);
    },
  );
}
