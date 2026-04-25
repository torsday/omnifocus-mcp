/**
 * `perspective_list` MCP tool — list all perspectives in OmniFocus.
 *
 * Returns both built-in perspectives (Inbox, Projects, Tags, Forecast,
 * Flagged, Nearby, Review) and custom perspectives (OmniFocus Pro).
 *
 * @see DESIGN.md §26 — reference implementation
 * @see src/services/perspectiveService.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { PerspectiveService } from "../../services/perspectiveService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PERSPECTIVE_LIST_DESCRIPTION =
  "List all perspectives in OmniFocus — both built-in (Inbox, Projects, Tags, Forecast, Flagged, Nearby, Review) and custom (OmniFocus Pro). " +
  "Do not use to evaluate a perspective; prefer perspective_evaluate for that. " +
  "Returns each perspective's id, name, kind (builtin|custom), and requiresPro flag. " +
  "Safe to call repeatedly; no side effects, no writes.";

// ---------------------------------------------------------------------------
// Input schema (no fields — list is always exhaustive)
// ---------------------------------------------------------------------------

export const perspectiveListInputSchema = z.object({});

export type PerspectiveListToolInput = z.infer<typeof perspectiveListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Minimum context the handler needs — injected by the registration helper. */
export interface PerspectiveListContext {
  perspectiveService: PerspectiveService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests without an McpServer.
 */
export async function handlePerspectiveList(
  _input: PerspectiveListToolInput,
  ctx: PerspectiveListContext,
) {
  const result = await ctx.perspectiveService.list();
  const meta = ctx.makeMeta({ cacheHit: result.cacheHit });
  return ok({ perspectives: result.perspectives }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `perspective_list` with an `McpServer` instance.
 */
export function registerPerspectiveListTool(server: McpServer, ctx: PerspectiveListContext) {
  return server.registerTool(
    "perspective_list",
    {
      description: PERSPECTIVE_LIST_DESCRIPTION,
      inputSchema: perspectiveListInputSchema.shape,
    },
    async (args: PerspectiveListToolInput) => {
      const envelope = await handlePerspectiveList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
