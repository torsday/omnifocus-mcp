/**
 * `task_parse_transport_text` MCP tool — parse OmniFocus transport text DSL
 * into structured task objects without creating any tasks.
 *
 * @see src/taskParser/transportText.ts — pure parser
 * @see src/tools/task/create.ts — use task_create to create the returned tasks
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { parseTransportText } from "../../taskParser/transportText.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION =
  "Parse OmniFocus transport text DSL into structured task objects — no tasks are created. " +
  "Supports @tag, #due-date, ::defer-date, !!, and //note tokens; a leading 'Project: Name' line sets the project context for subsequent tasks. " +
  "Do not use this tool to create tasks; pass the returned tasks[] to task_create separately. " +
  "Returns tasks[] with name, tagNames, dueDate, deferDate, flagged, note, and projectName fields, plus count and an optional warnings[] for unparseable dates. " +
  "Tag names and project names are raw strings — resolve to IDs with tag_list before passing to task_create. " +
  "Read-only; no side effects.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const taskParseTransportTextInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe(
      "Transport text to parse. One task per line; 'Project: Name' prefix sets project context.",
    ),
});

type TaskParseTransportTextInput = z.infer<typeof taskParseTransportTextInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ParseTransportTextContext {
  makeMeta: () => ResponseMeta;
}

export async function handleTaskParseTransportText(
  input: TaskParseTransportTextInput,
  ctx: ParseTransportTextContext,
) {
  const result = parseTransportText(input.text);
  const meta = ctx.makeMeta();
  // Parser advisories are surfaced in data.warnings (plain strings) rather
  // than meta.warnings (which requires a structured WarningCode). These are
  // parse-time hints, not protocol-level warnings.
  return ok(
    {
      tasks: result.tasks,
      count: result.tasks.length,
      ...(result.warnings.length > 0 && { warnings: result.warnings }),
    },
    meta,
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTaskParseTransportTextTool(
  server: McpServer,
  ctx: ParseTransportTextContext,
) {
  return server.registerTool(
    "task_parse_transport_text",
    {
      description: TASK_PARSE_TRANSPORT_TEXT_DESCRIPTION,
      inputSchema: taskParseTransportTextInputSchema.shape,
    },
    async (args: TaskParseTransportTextInput) => {
      const envelope = await handleTaskParseTransportText(args, ctx);
      return toolResponse(envelope);
    },
  );
}
