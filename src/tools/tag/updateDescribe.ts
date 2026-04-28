/**
 * `tag_update_describe` — preview what tag_update would do without mutating.
 *
 * @see src/tools/tag/update.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TagUpdateToolInput, tagUpdateInputSchema } from "./update.js";

export const TAG_UPDATE_DESCRIBE_DESCRIPTION =
  "Preview what tag_update would do without making any changes. " +
  "Do NOT use to actually update a tag — use tag_update instead. " +
  "Returns { description, plannedChanges } showing the fields that would be patched. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TagUpdateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTagUpdateDescribe(
  input: TagUpdateToolInput,
  ctx: TagUpdateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];
  let tagName: string = String(input.id);

  try {
    const tag = await ctx.adapter.getTag(input.id);
    tagName = tag.name;

    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name, oldValue: tag.name });
      parts.push(`rename to '${input.name}'`);
    }
    if (input.status !== undefined) {
      changes.push({ field: "status", newValue: input.status, oldValue: tag.status });
      parts.push(`set status to '${input.status}'`);
    }
    if (input.allowsNextAction !== undefined) {
      changes.push({
        field: "allowsNextAction",
        newValue: String(input.allowsNextAction),
        oldValue: String(tag.allowsNextAction),
      });
      parts.push(`set allowsNextAction to ${input.allowsNextAction}`);
    }
  } catch {
    if (input.name !== undefined) {
      changes.push({ field: "name", newValue: input.name });
      parts.push(`rename to '${input.name}'`);
    }
  }

  const description =
    parts.length > 0
      ? `Would update tag '${tagName}': ${parts.join(", ")}.`
      : `Would update tag '${tagName}' (no fields changed).`;

  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTagUpdateDescribeTool(server: McpServer, ctx: TagUpdateDescribeContext) {
  return server.registerTool(
    "tag_update_describe",
    { description: TAG_UPDATE_DESCRIBE_DESCRIPTION, inputSchema: tagUpdateInputSchema.shape },
    async (args: TagUpdateToolInput) => {
      const envelope = await handleTagUpdateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
