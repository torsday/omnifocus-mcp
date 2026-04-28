/**
 * `perspective_delete` MCP tool — delete a custom OmniFocus perspective.
 *
 * Routes to OmniJS `deleteObject` — JXA cannot delete custom perspectives.
 * Built-in perspectives are rejected with a validation error and left
 * untouched.
 *
 * @see #523 — perspective CRUD
 * @see src/services/perspectiveService.ts — delete()
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_DELETE_DESCRIPTION =
  "Delete a custom OmniFocus perspective by id. " +
  "Use when a perspective is no longer needed — e.g. cleaning up after a " +
  "templated workflow, or rotating out a stale view. " +
  "Do not use on built-in perspectives (inbox, projects, tags, forecast, " +
  "flagged, nearby, review) — they cannot be deleted; the call returns a " +
  "validation error. " +
  "Custom perspectives require OmniFocus Pro; without it the call returns " +
  "OF_FEATURE_REQUIRES_PRO. " +
  "Deletion is permanent — there is no undo for perspective removal in " +
  "OmniFocus, so confirm with the user before invoking on a perspective " +
  "they may want to keep. Recommend a sync_trigger after deletion so " +
  "other devices observe the change. " +
  "Returns { id } echoing the deleted identifier. " +
  "Side effects: writes to OmniFocus (removes the perspective from the " +
  "document), sets meta.syncPending = true. " +
  'Example: { "perspectiveId": "fOpKrtZBLaZ" } → { id: "fOpKrtZBLaZ" }.';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const perspectiveDeleteInputSchema = z.object({
  perspectiveId: z
    .string()
    .min(1)
    .describe(
      "Identifier of the custom perspective to delete. Obtain from " +
        'perspective_list (look for kind: "custom"). Built-in ids are ' +
        "rejected with a validation error — built-ins are immutable.",
    ),
});

export type PerspectiveDeleteToolInput = z.infer<typeof perspectiveDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface PerspectiveDeleteContext {
  perspectiveService: PerspectiveService;
  cache: InvalidatingCache;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handlePerspectiveDelete(
  input: PerspectiveDeleteToolInput,
  ctx: PerspectiveDeleteContext,
) {
  await ctx.perspectiveService.delete(input.perspectiveId);
  ctx.cache.invalidate("perspective:*");
  const meta = ctx.makeMeta({ cacheHit: false });
  return ok({ id: input.perspectiveId }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPerspectiveDeleteTool(server: McpServer, ctx: PerspectiveDeleteContext) {
  return server.registerTool(
    "perspective_delete",
    {
      description: PERSPECTIVE_DELETE_DESCRIPTION,
      inputSchema: perspectiveDeleteInputSchema.shape,
    },
    async (args: PerspectiveDeleteToolInput) => {
      const envelope = await handlePerspectiveDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
