/**
 * `perspective_evaluate` MCP tool — evaluate an OmniFocus perspective.
 *
 * Unified for built-in and custom perspectives: the service inspects the id
 * and routes built-in ids (`"inbox"`, `"flagged"`, …) to JXA and custom ids
 * (opaque strings from `perspective_list`) to OmniJS (#55). Custom
 * perspectives require OmniFocus Pro and surface `FeatureRequiresPro` when
 * the edition lacks the runtime.
 *
 * @see DESIGN.md §26
 * @see src/services/perspectiveService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_EVALUATE_DESCRIPTION =
  "Evaluate an OmniFocus perspective and return its task list. " +
  "Accepts both built-in ids (inbox, projects, tags, forecast, flagged, nearby, review) " +
  "and custom-perspective ids obtained from perspective_list — the tool selects the " +
  "correct transport internally (JXA for built-in, OmniJS for custom). " +
  "Custom perspectives require OmniFocus Pro; otherwise returns an error with " +
  "code OF_FEATURE_REQUIRES_PRO. " +
  "Returns { tasks: Task[] }. " +
  "For 'review', returns [] — use review_list_due instead. " +
  "For 'nearby', returns [] (location unavailable). " +
  "No side effects; read-only.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveEvaluateInputSchema = z.object({
  perspectiveId: z
    .string()
    .min(1)
    .describe(
      "OmniFocus perspective id. Accepts a built-in id " +
        "(inbox, projects, tags, forecast, flagged, nearby, review) or a custom-perspective " +
        "id from perspective_list (kind: custom).",
    ),
});

export type PerspectiveEvaluateToolInput = z.infer<typeof perspectiveEvaluateInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum context the handler needs — injected by the registration helper. */
export interface PerspectiveEvaluateContext {
  perspectiveService: PerspectiveService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests without an McpServer.
 */
export async function handlePerspectiveEvaluate(
  input: PerspectiveEvaluateToolInput,
  ctx: PerspectiveEvaluateContext,
) {
  const result = await ctx.perspectiveService.evaluate(input.perspectiveId);
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ tasks: result.tasks }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `perspective_evaluate` with an `McpServer` instance.
 */
export function registerPerspectiveEvaluateTool(
  server: McpServer,
  ctx: PerspectiveEvaluateContext,
) {
  return server.registerTool(
    "perspective_evaluate",
    {
      description: PERSPECTIVE_EVALUATE_DESCRIPTION,
      inputSchema: perspectiveEvaluateInputSchema.shape,
    },
    async (args: PerspectiveEvaluateToolInput) => {
      const envelope = await handlePerspectiveEvaluate(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
