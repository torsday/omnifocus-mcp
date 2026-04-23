/**
 * `sync_status` MCP tool — return the last OmniFocus sync state without triggering a new sync.
 *
 * Use this to check whether a previous sync completed before querying
 * cross-device data. Read-only; no side effects.
 *
 * @see src/adapter/OmniFocusAdapter.ts — SyncStatus
 * @see src/tools/sync/trigger.ts — sync_trigger (triggers a new sync)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const SYNC_STATUS_DESCRIPTION =
  "Return the last OmniFocus sync state without triggering a new sync. " +
  "Do NOT call this to initiate a sync — use sync_trigger instead. " +
  "Use to check whether a previous sync completed before querying cross-device data. " +
  "Returns { lastSyncAt, inFlight }. " +
  "lastSyncAt is null if OmniFocus has never synced in this session. " +
  "Read-only; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const syncStatusInputSchema = z.object({});
export type SyncStatusInput = z.infer<typeof syncStatusInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface SyncStatusContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleSyncStatus(_input: SyncStatusInput, ctx: SyncStatusContext) {
  const status = await ctx.adapter.getLastSync();
  return ok({ lastSyncAt: status.lastSyncAt, inFlight: status.inFlight }, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSyncStatusTool(server: McpServer, ctx: SyncStatusContext) {
  return server.registerTool(
    "sync_status",
    { description: SYNC_STATUS_DESCRIPTION, inputSchema: syncStatusInputSchema.shape },
    async (args: SyncStatusInput) => {
      const envelope = await handleSyncStatus(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
