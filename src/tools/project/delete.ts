/**
 * `project_delete` MCP tool — hard (unrecoverable) removal of an OmniFocus project.
 *
 * This is a destructive, irreversible operation. OmniFocus's `deleteObject`
 * API permanently removes the project AND all its contained tasks from the
 * database with no undo. Prefer `project_drop` when you want a recoverable
 * status change that keeps the project accessible.
 *
 * There is no `confirm` guard — the caller is responsible for verifying the
 * correct ID before calling. The description warns explicitly.
 *
 * @see DESIGN.md §26 — reference tool pattern
 * @see src/tools/task/delete.ts — task_delete (equivalent for tasks)
 * @see docs/domain-reference.md — drop vs. delete distinction
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ProjectId } from "../../domain/ids.js";
import { type ResponseMeta, ok } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PROJECT_DELETE_DESCRIPTION =
  "Permanently delete an OmniFocus project and ALL its contained tasks. " +
  "IRREVERSIBLE — uses OmniFocus deleteObject; there is no undo. " +
  "All tasks inside the project are also permanently deleted (cascade). " +
  "Prefer project_drop when you want a recoverable status change. " +
  "Only use project_delete when the agent has explicit user intent to permanently remove the project and its tasks. " +
  "Returns { deleted: true, id } on success. " +
  "Side effects: removes the project and its tasks from OmniFocus, sets meta.syncPending = true. " +
  "Call sync_trigger when you need the deletion to appear on other devices.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const projectDeleteInputSchema = z.object({
  id: ProjectId.schema.describe(
    "Persistent ID of the project to delete. Get from project_list. " +
      "Verify you have the correct ID before calling — this action is irreversible " +
      "and deletes all contained tasks.",
  ),
});

export type ProjectDeleteToolInput = z.infer<typeof projectDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ProjectDeleteContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler for `project_delete`.
 *
 * Delegates to `adapter.deleteProject` which handles cascade task removal,
 * cache invalidation, and raises `NotFound` for an unknown ID.
 *
 * @throws {NotFound} when the project ID does not exist in OmniFocus
 * @throws {OmniFocusNotRunning} when OmniFocus is not running
 */
export async function handleProjectDelete(
  input: ProjectDeleteToolInput,
  ctx: ProjectDeleteContext,
) {
  await ctx.adapter.deleteProject(input.id);
  return ok({ deleted: true as const, id: input.id }, ctx.makeMeta({ syncPending: true }));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectDeleteTool(server: McpServer, ctx: ProjectDeleteContext) {
  return server.registerTool(
    "project_delete",
    { description: PROJECT_DELETE_DESCRIPTION, inputSchema: projectDeleteInputSchema.shape },
    async (args: ProjectDeleteToolInput) => {
      const envelope = await handleProjectDelete(args, ctx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
      };
    },
  );
}
