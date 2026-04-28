/**
 * `plugin_invoke` MCP tool — invoke a named Omni Automation plug-in action.
 *
 * Executes the plug-in via the OmniJS transport (OmniJS has the only PlugIn
 * runtime; JXA cannot access the plug-in API). The `identifier` must be the
 * plug-in's bundle identifier exactly (e.g. `"com.example.my-plugin"`).
 *
 * @see DESIGN.md §6.3 — OmniJS transport for Omni Automation surfaces
 * @see src/scripts/omnijs/plugin_invoke.js — OmniJS script
 * @see src/services/pluginService.ts — service layer
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { PluginService } from "../../services/pluginService.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const PLUGIN_INVOKE_DESCRIPTION =
  "Invoke a named Omni Automation plug-in action in OmniFocus. " +
  "Use this when you need to run a specific installed plug-in — not for built-in OmniFocus operations. " +
  "Do NOT use to run arbitrary JavaScript; for raw scripting use run_omnijs_script (requires opt-in env var). " +
  '`identifier` is the plug-in\'s bundle ID (e.g. `"com.example.my-plugin"`). ' +
  "`arg` is an optional JSON-serialisable value passed to the plug-in action as Action.args[0]. " +
  "Returns { result } where result is the plug-in's return value (arbitrary JSON). " +
  "Throws NotFound if the plug-in is not installed. " +
  "Side effects: plug-in may mutate OmniFocus data; call sync_trigger if you need changes on other devices. " +
  'Example: plugin_invoke({ identifier: "com.example.my-plugin" }) ' +
  'Example: plugin_invoke({ identifier: "com.example.my-plugin", arg: { mode: "export" } })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const pluginInvokeInputSchema = z.object({
  identifier: z
    .string()
    .min(1)
    .describe(
      'Bundle identifier of the Omni Automation plug-in to invoke (e.g. "com.example.my-plugin").',
    ),
  arg: z
    .unknown()
    .optional()
    .describe(
      "Optional JSON-serialisable argument forwarded to the plug-in action as Action.args[0]. Defaults to null.",
    ),
});
export type PluginInvokeInput = z.infer<typeof pluginInvokeInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface PluginInvokeContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handlePluginInvoke(input: PluginInvokeInput, ctx: PluginInvokeContext) {
  const service = new PluginService({ adapter: ctx.adapter });
  const { result } = await service.invoke({ identifier: input.identifier, arg: input.arg });
  const meta = ctx.makeMeta();
  return ok({ result }, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPluginInvokeTool(server: McpServer, ctx: PluginInvokeContext) {
  return server.registerTool(
    "plugin_invoke",
    { description: PLUGIN_INVOKE_DESCRIPTION, inputSchema: pluginInvokeInputSchema.shape },
    async (args: PluginInvokeInput) => {
      const envelope = await handlePluginInvoke(args, ctx);
      return toolResponse(envelope);
    },
  );
}
