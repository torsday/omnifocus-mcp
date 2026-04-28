/**
 * `database_undo` MCP tool — reverse the most recent document mutation.
 *
 * Wraps `Database.undo()` from OmniJS. Behaves identically to ⌘Z in the
 * OmniFocus UI: walks back one entry on the document's undo stack
 * regardless of source. The agent uses this as an escape hatch when a
 * batch mutation went wrong, when a retry left partial state behind, or
 * to clean up after a destructive integration test.
 *
 * The undo stack is per-document and shared across MCP calls. An undo
 * issued by the MCP can revert a manual UI edit if that was the most
 * recent mutation — the MCP can't track "MCP-only" mutations because OF
 * doesn't expose that distinction. The `meta.warnings[]` field surfaces
 * this when relevant.
 *
 * @see #526
 * @see src/scripts/omnijs/database_undo.js — OmniJS wrapper
 * @see src/tools/database/redo.ts — companion
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type ClearableCache, invalidateOnUndoRedo } from "../../cache/invalidation.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const DATABASE_UNDO_DESCRIPTION =
  "Reverse the most recent document mutation, identical to ⌘Z in OmniFocus. " +
  "Walks back one entry on the document's undo stack regardless of mutation source — " +
  "an MCP undo can revert a manual UI edit if that was the most recent change. " +
  "Mandatory `confirm: true` mirrors task_batch_delete's destructive-write pattern, " +
  "since undo can silently revert changes the agent or another caller just made. " +
  "Returns { undid: boolean } — true when an entry was undone, false when the stack was empty. " +
  "Do NOT use this tool to roll back specific operations — the undo stack is opaque " +
  "and you cannot inspect what would be reverted before calling. " +
  "Prefer database_undo for: post-batch error recovery, retry-after-partial-failure " +
  "cleanup, and integration-test teardown. " +
  "Side effects: reverts whatever entry is at the top of the document's undo stack; " +
  "fully invalidates the read cache (we don't know what was reverted); does NOT trigger sync. " +
  "Call sync_trigger when you need the change to appear on other devices. " +
  "Example: database_undo({ confirm: true })";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const databaseUndoInputSchema = z.object({
  confirm: z
    .literal(true)
    .describe(
      "Explicit acknowledgement that undo can revert mutations from any source — " +
        "MCP, manual UI edit, or sync replay. Must be exactly true. The call is rejected " +
        "if this field is absent or false.",
    ),
});

export type DatabaseUndoInput = z.infer<typeof databaseUndoInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface DatabaseUndoContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: ClearableCache;
}

export async function handleDatabaseUndo(_input: DatabaseUndoInput, ctx: DatabaseUndoContext) {
  const result = await ctx.adapter.undoLastMutation();

  // Full cache flush only when something was actually reverted. A no-op
  // undo (empty stack) doesn't change document state, so the cache is
  // still valid.
  if (result.undid && ctx.cache !== undefined) {
    invalidateOnUndoRedo(ctx.cache);
  }

  return ok(result, ctx.makeMeta({ syncPending: result.undid }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDatabaseUndoTool(server: McpServer, ctx: DatabaseUndoContext) {
  return server.registerTool(
    "database_undo",
    {
      description: DATABASE_UNDO_DESCRIPTION,
      inputSchema: databaseUndoInputSchema.shape,
    },
    async (args: DatabaseUndoInput) => {
      const envelope = await handleDatabaseUndo(args, ctx);
      return toolResponse(envelope);
    },
  );
}
