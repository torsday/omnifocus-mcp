/**
 * `perspective_get` MCP tool — read a custom perspective's full configuration.
 *
 * Surfaces what `perspective_list` cannot: the top-level aggregation, the
 * rule tree, and the icon color. Built-in perspectives have no rule tree
 * and are rejected with a typed validation error — agents should not call
 * this on built-in ids.
 *
 * @see #523 — perspective CRUD
 * @see src/services/perspectiveService.ts — get()
 * @see src/domain/perspective.ts — PerspectiveDetail
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_GET_DESCRIPTION =
  "Read the full configuration of a custom OmniFocus perspective — name, " +
  "top-level rule aggregation (all/any/none), the structured rule tree, and " +
  "icon color (when set). " +
  "Use to introspect what a perspective filters on before evaluating it, or " +
  "as a building block for cloning / duplicating perspectives. " +
  "Do not use on built-in perspectives (inbox, projects, tags, forecast, " +
  "flagged, nearby, review) — they have no rule tree and the call returns a " +
  "validation error. Use perspective_list instead to enumerate available " +
  "perspectives. " +
  "Custom perspectives require OmniFocus Pro; without it the call returns " +
  "OF_FEATURE_REQUIRES_PRO. " +
  "Returns { perspective: { id, name, aggregation, rules, iconColor } }. " +
  "Safe to call repeatedly; no side effects, no writes. " +
  'Example: { "perspectiveId": "fOpKrtZBLaZ" } → { perspective: { id, name: "Daily Triage", aggregation: "any", rules: [...], iconColor: { r: 0.2, g: 0.5, b: 0.9, a: 1 } } }.';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveGetInputSchema = z.object({
  perspectiveId: z
    .string()
    .min(1)
    .describe(
      "Identifier of the custom perspective to read. Obtain from " +
        'perspective_list (look for kind: "custom"). Built-in ids ' +
        "(inbox, projects, tags, forecast, flagged, nearby, review) " +
        "are rejected with a validation error — built-ins have no rule tree.",
    ),
});

export type PerspectiveGetToolInput = z.infer<typeof perspectiveGetInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface PerspectiveGetContext {
  perspectiveService: PerspectiveService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handlePerspectiveGet(
  input: PerspectiveGetToolInput,
  ctx: PerspectiveGetContext,
) {
  const perspective = await ctx.perspectiveService.get(input.perspectiveId);
  const meta = ctx.makeMeta({ cacheHit: false });
  return ok({ perspective }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerspectiveGetTool(server: McpServer, ctx: PerspectiveGetContext) {
  return server.registerTool(
    "perspective_get",
    {
      description: PERSPECTIVE_GET_DESCRIPTION,
      inputSchema: perspectiveGetInputSchema.shape,
    },
    async (args: PerspectiveGetToolInput) => {
      const envelope = await handlePerspectiveGet(args, ctx);
      return toolResponse(envelope);
    },
  );
}
