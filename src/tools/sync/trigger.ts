/**
 * `sync_trigger` MCP tool — kick off an OmniFocus sync with Omni Sync Server.
 *
 * Mutations on this server do not automatically propagate to other devices.
 * Every mutation response carries `meta.syncPending = true` to signal that
 * uncommitted writes exist. Agents call this tool to flush them.
 *
 * The underlying `synchronize()` call returns immediately — it is not a
 * blocking wait for the sync to complete. The response reflects the kickoff
 * time, not completion. If you need to confirm sync completion, poll
 * `sync_status` after an appropriate interval.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/scripts/jxa/sync_trigger.js — JXA script
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type ClearableCache, invalidateOnSync } from "../../cache/invalidation.js";
import { type ResponseMeta, ok, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const SYNC_TRIGGER_DESCRIPTION =
  "Kick off an OmniFocus sync with Omni Sync Server. " +
  "Do not call when no mutations have been made; prefer checking meta.syncPending first. " +
  "Call this after any sequence of mutations (task_create, task_update, folder_create, etc.) " +
  "when you need changes to appear on other devices. " +
  "The sync starts immediately but completes asynchronously — this tool does not block until done. " +
  "Returns meta.syncPending = false to confirm the sync was initiated. " +
  "Side effects: triggers a sync request to Omni Sync Server.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const syncTriggerInputSchema = z.object({});
export type SyncTriggerInput = z.infer<typeof syncTriggerInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface SyncTriggerContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /**
   * Optional cache; when supplied, `invalidateOnSync` clears every cached
   * read after the sync is kicked off (remote edits could be pulled in that
   * invalidate any row). See docs/cache-invalidation.md.
   */
  cache?: ClearableCache;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * Returns `meta.syncPending = false` to signal that the sync was initiated
 * and the server's pending-write flag has been cleared.
 */
export async function handleSyncTrigger(_input: SyncTriggerInput, ctx: SyncTriggerContext) {
  const status = await ctx.adapter.syncTrigger();
  if (ctx.cache !== undefined) invalidateOnSync(ctx.cache);
  // syncPending: false — sync was kicked off; pending writes are now in-flight.
  const meta = ctx.makeMeta({ syncPending: false });
  return ok({ lastSyncAt: status.lastSyncAt, inFlight: status.inFlight }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSyncTriggerTool(server: McpServer, ctx: SyncTriggerContext) {
  return server.registerTool(
    "sync_trigger",
    { description: SYNC_TRIGGER_DESCRIPTION, inputSchema: syncTriggerInputSchema.shape },
    async (args: SyncTriggerInput) => {
      const envelope = await handleSyncTrigger(args, ctx);
      return toolResponse(envelope);
    },
  );
}
