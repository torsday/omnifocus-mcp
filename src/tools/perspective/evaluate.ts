/**
 * `perspective_evaluate` MCP tool — evaluate a built-in OmniFocus perspective.
 *
 * Returns the task list for a given built-in perspective ID. Built-in
 * perspectives only (JXA path); custom perspectives are #55.
 *
 * @see DESIGN.md §26
 * @see src/services/perspectiveService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BuiltinPerspectiveId } from "../../domain/perspective.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_EVALUATE_DESCRIPTION =
  "Evaluate a built-in OmniFocus perspective and return its task list. " +
  "Built-in perspectives only (Inbox, Projects, Tags, Forecast, Flagged, Nearby, Review). " +
  "For custom perspectives, use the perspective_evaluate tool with a Pro OmniJS route (#55). " +
  "Returns { tasks: Task[] }. " +
  "For 'review', returns [] — use review_list_due instead. " +
  "For 'nearby', returns [] (location unavailable). " +
  "No side effects; read-only.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveEvaluateInputSchema = z.object({
  perspectiveId: z
    .enum(["inbox", "projects", "tags", "forecast", "flagged", "nearby", "review"])
    .describe("Built-in OmniFocus perspective ID."),
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
  const result = await ctx.perspectiveService.evaluate(input.perspectiveId as BuiltinPerspectiveId);
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
