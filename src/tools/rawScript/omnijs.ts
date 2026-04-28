/**
 * `run_omnijs_script` MCP tool — raw OmniJS escape hatch (DANGEROUS).
 *
 * Per ADR-0004, this tool is **off by default**. It is only registered when
 * `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`. Every invocation emits a
 * `raw_script.invoked` audit event at `info` with the full script body.
 *
 * OmniJS is Omni Automation's native runtime (`OmniJS`, `PlugIn.Action`,
 * perspective APIs, etc.). Use this only when a feature is unreachable from
 * both JXA and the typed tools.
 *
 * @see docs/adr/0004-opt-in-raw-script-tools.md
 * @see DESIGN.md §21 — audit logging
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { logger as defaultLogger } from "../../logging/logger.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const RUN_OMNIJS_SCRIPT_DESCRIPTION =
  "⚠ DANGEROUS — raw OmniJS escape hatch. Executes an arbitrary Omni Automation " +
  "(OmniJS) script against OmniFocus with FULL Automation privileges (read, write, " +
  "delete, move, sync, plug-in APIs). Only available when the server was started with " +
  "OMNIFOCUS_ALLOW_RAW_SCRIPT=1. Every call is audit-logged with the full script body. " +
  "Do NOT use this for operations covered by the typed tools (task_*, project_*, " +
  "plugin_invoke, etc.) — typed tools are safer, idempotent, and return structured " +
  "results. Use ONLY when you need a feature no typed tool exposes AND you control the " +
  "environment. " +
  "`script` is a raw OmniJS program; the serialised result must be JSON-encodable. " +
  "`arg` is an optional JSON-serialisable value forwarded through the callback-file bridge " +
  "(defaults to `{}`). " +
  "Returns { result } where result is the parsed JSON output of the script (arbitrary shape). " +
  "Side effects: may mutate, delete, or exfiltrate any OmniFocus data the user has access to. " +
  "Use sync_trigger separately if the script mutated data and you need it to propagate. " +
  'Example: run_omnijs_script({ script: "flattenedProjects.length" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const runOmniJsScriptInputSchema = z.object({
  script: z
    .string()
    .min(1)
    .describe("Raw OmniJS script body. Must produce a JSON-encodable result."),
  arg: z
    .unknown()
    .optional()
    .describe(
      "Optional JSON-serialisable argument forwarded through the callback-file bridge. Defaults to `{}`.",
    ),
});
export type RunOmniJsScriptInput = z.infer<typeof runOmniJsScriptInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface RunOmniJsScriptContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Override the audit logger in tests; production uses the module singleton. */
  logger?: Pick<Logger, "info">;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * @throws {ValidationError} if the adapter does not expose `runOmniJsScript`.
 */
export async function handleRunOmniJsScript(
  input: RunOmniJsScriptInput,
  ctx: RunOmniJsScriptContext,
) {
  if (typeof ctx.adapter.runOmniJsScript !== "function") {
    throw new ValidationError("run_omnijs_script is not available in this adapter configuration", {
      details: { reason: "raw-script-unavailable" },
      suggestion: "Start the server with OMNIFOCUS_ALLOW_RAW_SCRIPT=1 to enable raw-script tools.",
    });
  }

  const log = ctx.logger ?? defaultLogger;
  log.info(
    {
      event: "raw_script.invoked",
      tool: "run_omnijs_script",
      scriptLength: input.script.length,
      script: input.script,
    },
    "raw OmniJS script invoked",
  );

  const result = await ctx.adapter.runOmniJsScript(input.script, input.arg);
  return ok(
    { result },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: "Ran OmniJS script." }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RunOmniJsScriptRegistrationOptions {
  /** When false (default), the tool is not registered — see ADR-0004. */
  allowRawScript: boolean;
}

export function registerRunOmniJsScriptTool(
  server: McpServer,
  ctx: RunOmniJsScriptContext,
  opts: RunOmniJsScriptRegistrationOptions,
) {
  if (!opts.allowRawScript) return null;
  return server.registerTool(
    "run_omnijs_script",
    {
      description: RUN_OMNIJS_SCRIPT_DESCRIPTION,
      inputSchema: runOmniJsScriptInputSchema.shape,
    },
    async (args: RunOmniJsScriptInput) => {
      const envelope = await handleRunOmniJsScript(args, ctx);
      return toolResponse(envelope);
    },
  );
}
