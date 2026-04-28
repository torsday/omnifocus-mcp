/**
 * `tag_create_describe` — preview what tag_create would do without mutating.
 *
 * @see src/tools/tag/create.ts — write counterpart
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { resolveTagName } from "../describe/prose.js";
import type { ChangeRecord } from "../describe/types.js";
import { type TagCreateToolInput, tagCreateInputSchema } from "./create.js";

export const TAG_CREATE_DESCRIBE_DESCRIPTION =
  "Preview what tag_create would do without making any changes. " +
  "Do NOT use to actually create a tag — use tag_create instead. " +
  "Returns { description, plannedChanges } describing the tag that would be created. " +
  "No side effects: read-only by contract — never mutates OmniFocus. " +
  "Example: dry-run companion — pass the same args you would to the write tool, inspect plannedChanges, then call the write tool once approved.";

export interface TagCreateDescribeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleTagCreateDescribe(
  input: TagCreateToolInput,
  ctx: TagCreateDescribeContext,
) {
  const changes: ChangeRecord[] = [];
  const parts: string[] = [];

  changes.push({ field: "name", newValue: input.name });
  parts.push(`'${input.name}'`);

  if (input.parentId !== undefined) {
    const parentName = await resolveTagName(ctx.adapter, input.parentId);
    changes.push({ field: "parentId", newValue: input.parentId });
    parts.push(`under '${parentName}'`);
  } else {
    parts.push("at root");
  }

  if (input.status !== undefined) {
    changes.push({ field: "status", newValue: input.status });
    parts.push(`status '${input.status}'`);
  }

  const description = `Would create tag ${parts.join(", ")}.`;
  return ok({ description, plannedChanges: changes }, ctx.makeMeta());
}

export function registerTagCreateDescribeTool(server: McpServer, ctx: TagCreateDescribeContext) {
  return server.registerTool(
    "tag_create_describe",
    { description: TAG_CREATE_DESCRIBE_DESCRIPTION, inputSchema: tagCreateInputSchema.shape },
    async (args: TagCreateToolInput) => {
      const envelope = await handleTagCreateDescribe(args, ctx);
      return toolResponse(envelope);
    },
  );
}
