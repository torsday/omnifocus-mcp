/**
 * `database_redo` MCP tool — re-apply the most recently undone mutation.
 *
 * Wraps `Database.redo()` from OmniJS. Mirror of `database_undo`. Behaves
 * identically to ⌘⇧Z in the OmniFocus UI: advances one entry on the
 * document's redo stack. Any mutation between an undo and a redo
 * invalidates the redo stack (matching UI semantics).
 *
 * @see #526
 * @see src/scripts/omnijs/database_redo.js — OmniJS wrapper
 * @see src/tools/database/undo.ts — companion
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { type ClearableCache, invalidateOnUndoRedo } from "../../cache/invalidation.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description (DESIGN §6.8 four-section shape)
// ---------------------------------------------------------------------------

export const DATABASE_REDO_DESCRIPTION =
  "Re-apply the most recently undone mutation, identical to ⌘⇧Z in OmniFocus. " +
  "Advances one entry on the document's redo stack. Any mutation between an undo and " +
  "a redo invalidates the redo stack (matching UI semantics). " +
  "Mandatory `confirm: true` mirrors database_undo's destructive-write pattern. " +
  "Returns { redid: boolean } — true when an entry was redone, false when the stack was empty. " +
  "Do NOT use this tool to re-apply a specific operation — the redo stack is opaque. " +
  "Prefer database_redo only as a direct counterpart to database_undo when an undo was issued in error. " +
  "Side effects: re-applies whatever entry is at the top of the document's redo stack; " +
  "fully invalidates the read cache; does NOT trigger sync. " +
  "Call sync_trigger when you need the change to appear on other devices. " +
  "Example: database_redo({ confirm: true })";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const databaseRedoInputSchema = z.object({
  confirm: z
    .literal(true)
    .describe(
      "Explicit acknowledgement that redo can re-apply a mutation that may now conflict " +
        "with intervening edits. Must be exactly true. The call is rejected if this field " +
        "is absent or false.",
    ),
});

export type DatabaseRedoInput = z.infer<typeof databaseRedoInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface DatabaseRedoContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  cache?: ClearableCache;
}

export async function handleDatabaseRedo(_input: DatabaseRedoInput, ctx: DatabaseRedoContext) {
  const result = await ctx.adapter.redoLastMutation();

  if (result.redid && ctx.cache !== undefined) {
    invalidateOnUndoRedo(ctx.cache);
  }

  return ok(result, ctx.makeMeta({ syncPending: result.redid }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDatabaseRedoTool(server: McpServer, ctx: DatabaseRedoContext) {
  return server.registerTool(
    "database_redo",
    {
      description: DATABASE_REDO_DESCRIPTION,
      inputSchema: databaseRedoInputSchema.shape,
    },
    async (args: DatabaseRedoInput) => {
      const envelope = await handleDatabaseRedo(args, ctx);
      return toolResponse(envelope);
    },
  );
}
