/**
 * `app_launch` MCP tool — explicitly launch OmniFocus.
 *
 * Per SPEC resolved-decisions: OmniFocus is never auto-launched. An agent
 * must call this tool explicitly when the user asks to open OmniFocus.
 * Idempotent — safe to call when OmniFocus is already running.
 *
 * @see DESIGN.md §6.3 — lifecycle layer (app launch is JXA)
 * @see src/scripts/jxa/app_launch.js — JXA script
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const APP_LAUNCH_DESCRIPTION =
  "Explicitly launch OmniFocus. Do NOT call this automatically — only invoke when the user " +
  "explicitly asks to open OmniFocus; prefer other tools when OF is already running. " +
  "Safe to call when OmniFocus is already running (idempotent). " +
  "Returns { launched, alreadyRunning } — launched=true means OmniFocus was not running and " +
  "was started; alreadyRunning=true means it was already open. " +
  "Side effects: may open OmniFocus and bring it to the foreground. " +
  "Example: app_launch()";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const appLaunchInputSchema = z.object({});
export type AppLaunchInput = z.infer<typeof appLaunchInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface AppLaunchContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleAppLaunch(_input: AppLaunchInput, ctx: AppLaunchContext) {
  const result = await ctx.adapter.appLaunch();
  const meta = ctx.makeMeta();
  return ok({ launched: result.launched, alreadyRunning: result.alreadyRunning }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAppLaunchTool(server: McpServer, ctx: AppLaunchContext) {
  return server.registerTool(
    "app_launch",
    { description: APP_LAUNCH_DESCRIPTION, inputSchema: appLaunchInputSchema.shape },
    async (args: AppLaunchInput) => {
      const envelope = await handleAppLaunch(args, ctx);
      return toolResponse(envelope);
    },
  );
}
