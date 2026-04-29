/**
 * `perspective_evaluate_dry_run` MCP tool — preview a *proposed* OmniFocus
 * perspective rule tree without persisting it (per #659).
 *
 * Pairs with `perspective_create` for the propose-then-save flow used by the
 * `perspective-author` prompt (#476): the agent proposes rules from natural
 * language, the user previews matched tasks via this tool, then commits the
 * perspective via `perspective_create`.
 *
 * Reuses the same `PerspectiveRuleInputSchema` as `perspective_create` so
 * the rule tree from a successful dry-run can be passed verbatim to the
 * persistent create call without re-validation.
 *
 * @see #659 — issue
 * @see src/tools/perspective/create.ts — companion create flow
 * @see src/scripts/omnijs/perspective_evaluate_dry_run.js — script
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type PerspectiveAggregation,
  PerspectiveRuleInputSchema,
} from "../../domain/perspectiveRules.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_EVALUATE_DRY_RUN_DESCRIPTION =
  "Preview a *proposed* OmniFocus perspective rule tree without persisting it. " +
  "Creates a temporary perspective with the supplied rules, evaluates it, and " +
  "always deletes the temp perspective inside one OmniJS execution. " +
  "Pairs with perspective_create for the propose-then-save flow used by the " +
  "perspective-author prompt: propose rules → preview matched tasks via this " +
  "tool → commit via perspective_create. " +
  "Custom perspectives require OmniFocus Pro; otherwise returns " +
  "OF_FEATURE_REQUIRES_PRO. " +
  "Do NOT use to evaluate a *saved* perspective — use perspective_evaluate. " +
  "Returns { tasks: Task[] }. " +
  "Side effects: creates and immediately deletes a sentinel-named temp " +
  "perspective inside one OmniJS execution; the database state is unchanged " +
  "after the call returns. " +
  "Example: perspective_evaluate_dry_run({ aggregation: 'all', rules: [{ actionStatus: 'flagged' }] })";

const PerspectiveAggregationInputSchema: z.ZodType<PerspectiveAggregation> = z.enum([
  "all",
  "any",
  "none",
]);

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveEvaluateDryRunInputSchema = z.object({
  aggregation: PerspectiveAggregationInputSchema.optional().describe(
    'Top-level rule aggregation. One of "all", "any", "none". Defaults to "all" when omitted.',
  ),
  rules: z
    .array(PerspectiveRuleInputSchema)
    .describe(
      "Top-level rule list to evaluate. Empty array means 'show everything' " +
        "(matches every available task). Each rule is an atom (single action* " +
        "predicate), an aggregate (compound rule with aggregateType + " +
        "aggregateRules), or a disabled wrapper around either.",
    ),
});

export type PerspectiveEvaluateDryRunToolInput = z.infer<
  typeof perspectiveEvaluateDryRunInputSchema
>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface PerspectiveEvaluateDryRunContext {
  perspectiveService: PerspectiveService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handlePerspectiveEvaluateDryRun(
  input: PerspectiveEvaluateDryRunToolInput,
  ctx: PerspectiveEvaluateDryRunContext,
) {
  const result = await ctx.perspectiveService.evaluateRules(input.rules, input.aggregation);
  return ok({ tasks: result.tasks }, ctx.makeMeta({ cacheHit: false }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerspectiveEvaluateDryRunTool(
  server: McpServer,
  ctx: PerspectiveEvaluateDryRunContext,
) {
  return server.registerTool(
    "perspective_evaluate_dry_run",
    {
      description: PERSPECTIVE_EVALUATE_DRY_RUN_DESCRIPTION,
      inputSchema: perspectiveEvaluateDryRunInputSchema.shape,
    },
    async (args: PerspectiveEvaluateDryRunToolInput) => {
      const envelope = await handlePerspectiveEvaluateDryRun(args, ctx);
      return toolResponse(envelope);
    },
  );
}
