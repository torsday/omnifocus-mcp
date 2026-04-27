/**
 * Window-control tools — `window_get_state`, `window_set_perspective`,
 * `window_set_focus` (#466).
 *
 * UI-affecting; advisory. These mutate the front OmniFocus window's
 * perspective and focus container — they do NOT touch the data model and
 * do NOT invalidate any data caches. Tool descriptions are explicit so an
 * agent in a headless flow doesn't accidentally fire them.
 *
 * @see #466
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

export interface WindowToolContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

// ---------------------------------------------------------------------------
// window_get_state
// ---------------------------------------------------------------------------

export const WINDOW_GET_STATE_DESCRIPTION =
  "Read the active perspective and focus container of the front OmniFocus window. " +
  "**UI-affecting tool family** — only meaningful in pair-assistant flows where the user is looking at OmniFocus. Headless agents should ignore. " +
  "Use when the agent needs to know what view the user currently sees, or to confirm that a prior `window_set_*` took effect. " +
  "Do NOT use to evaluate a perspective's data — prefer `perspective_evaluate`, which doesn't depend on UI state. " +
  "Takes no arguments. " +
  "Returns { perspectiveName: string | null, focusContainerIds: string[] } — perspectiveName is null when no perspective is bound; focusContainerIds is [] when the window isn't focused on a project or folder. " +
  "Errors: OF_WINDOW_UNAVAILABLE when OmniFocus has no front window. " +
  "Read-only; safe to retry.";

export const windowGetStateInputSchema = z.object({});
export type WindowGetStateToolInput = z.infer<typeof windowGetStateInputSchema>;

export async function handleWindowGetState(
  _input: WindowGetStateToolInput,
  ctx: WindowToolContext,
) {
  const result = await ctx.adapter.getWindowState();
  return ok(result, ctx.makeMeta());
}

export function registerWindowGetStateTool(server: McpServer, ctx: WindowToolContext) {
  return server.registerTool(
    "window_get_state",
    {
      description: WINDOW_GET_STATE_DESCRIPTION,
      inputSchema: windowGetStateInputSchema.shape,
    },
    async (args: WindowGetStateToolInput) => toolResponse(await handleWindowGetState(args, ctx)),
  );
}

// ---------------------------------------------------------------------------
// window_set_perspective
// ---------------------------------------------------------------------------

export const WINDOW_SET_PERSPECTIVE_DESCRIPTION =
  "Switch the front OmniFocus window to a named perspective (built-in or custom). " +
  "**UI-affecting tool** — only meaningful when the user can see OmniFocus. Headless agents should not fire this. " +
  "Use when the user asks 'show me my flagged tasks' or a guided weekly-review prompt wants to navigate the user's UI. " +
  "Do NOT use to evaluate a perspective's results — prefer perspective_evaluate, which doesn't touch the user's UI. " +
  "Pass perspectiveName (case-sensitive, matches OF's UX). Built-in names: Inbox, Projects, Tags, Forecast, Flagged, Review, Nearby, Completed, Changed. " +
  "Returns { perspectiveName }. " +
  "Errors: OF_WINDOW_UNAVAILABLE (no front window), OF_NOT_FOUND (no perspective with this name). " +
  "Side effects: changes the user's visible window state; no data caches invalidated.";

export const windowSetPerspectiveInputSchema = z.object({
  perspectiveName: z
    .string()
    .min(1)
    .describe(
      "Name of the perspective to activate. Case-sensitive. Built-in or custom perspectives both work.",
    ),
});
export type WindowSetPerspectiveToolInput = z.infer<typeof windowSetPerspectiveInputSchema>;

export async function handleWindowSetPerspective(
  input: WindowSetPerspectiveToolInput,
  ctx: WindowToolContext,
) {
  const result = await ctx.adapter.setWindowPerspective(input.perspectiveName);
  return ok(result, ctx.makeMeta());
}

export function registerWindowSetPerspectiveTool(server: McpServer, ctx: WindowToolContext) {
  return server.registerTool(
    "window_set_perspective",
    {
      description: WINDOW_SET_PERSPECTIVE_DESCRIPTION,
      inputSchema: windowSetPerspectiveInputSchema.shape,
    },
    async (args: WindowSetPerspectiveToolInput) =>
      toolResponse(await handleWindowSetPerspective(args, ctx)),
  );
}

// ---------------------------------------------------------------------------
// window_set_focus
// ---------------------------------------------------------------------------

export const WINDOW_SET_FOCUS_DESCRIPTION =
  "Set or clear the front OmniFocus window's focus container (a project or folder). " +
  "**UI-affecting tool** — only meaningful when the user can see OmniFocus. Headless agents should not fire this. " +
  "Use when the user asks 'focus on this project' or a guided flow wants to scope the visible view. " +
  "Do NOT use to filter task data — prefer `task_list { projectId }` or `perspective_evaluate` instead, both of which work without touching the user's UI. " +
  "Pass containerId (a ProjectId or FolderId) to focus, or null to clear focus. " +
  "Returns { focusContainerIds: string[] } — single-element array when focused, [] when cleared. " +
  "Errors: OF_WINDOW_UNAVAILABLE (no front window), OF_NOT_FOUND (containerId is neither a project nor a folder). " +
  "Side effects: changes the user's visible window state; no data caches invalidated.";

export const windowSetFocusInputSchema = z.object({
  containerId: z
    .union([z.string().min(1), z.null()])
    .describe("ProjectId or FolderId to focus the front window on, or null to clear focus."),
});
export type WindowSetFocusToolInput = z.infer<typeof windowSetFocusInputSchema>;

export async function handleWindowSetFocus(input: WindowSetFocusToolInput, ctx: WindowToolContext) {
  const result = await ctx.adapter.setWindowFocus(input.containerId);
  return ok(result, ctx.makeMeta());
}

export function registerWindowSetFocusTool(server: McpServer, ctx: WindowToolContext) {
  return server.registerTool(
    "window_set_focus",
    {
      description: WINDOW_SET_FOCUS_DESCRIPTION,
      inputSchema: windowSetFocusInputSchema.shape,
    },
    async (args: WindowSetFocusToolInput) => toolResponse(await handleWindowSetFocus(args, ctx)),
  );
}
