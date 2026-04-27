/**
 * `run_jxa_script` MCP tool — raw JXA escape hatch (DANGEROUS).
 *
 * Per ADR-0004, this tool is **off by default**. It is only registered when
 * `OMNIFOCUS_ALLOW_RAW_SCRIPT=1`. Every invocation emits a
 * `raw_script.invoked` audit event at `info` with the full script body.
 *
 * Exists so advanced users can reach corners of OmniFocus the typed tools
 * don't cover. Typed tools should always be preferred — they are safer,
 * composable, and return richer envelopes.
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

export const RUN_JXA_SCRIPT_DESCRIPTION =
  "⚠ DANGEROUS — raw JXA escape hatch. Executes an arbitrary JavaScript-for-Automation " +
  "script against OmniFocus with FULL Automation privileges (read, write, delete, move, " +
  "sync). Only available when the server was started with OMNIFOCUS_ALLOW_RAW_SCRIPT=1. " +
  "Every call is audit-logged with the full script body. " +
  "Do NOT use this for operations covered by the typed tools (task_*, project_*, tag_*, " +
  "folder_*, etc.) — typed tools are safer, idempotent, and return structured results. " +
  "Use ONLY when you need a feature no typed tool exposes AND you control the environment. " +
  "`script` must be a JXA program that defines `function run(argv)` and returns a " +
  "JSON-encoded string. `arg` is an optional JSON-serialisable value passed as argv[0] " +
  "(defaults to `{}`). " +
  "Returns { result } where result is the parsed JSON output of the script (arbitrary shape). " +
  "Side effects: may mutate, delete, or exfiltrate any OmniFocus data the user has access to. " +
  "Use sync_trigger separately if the script mutated data and you need it to propagate.";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const runJxaScriptInputSchema = z.object({
  script: z
    .string()
    .min(1)
    .describe(
      "Raw JXA script body. Must define `function run(argv)` and return a JSON-encoded string.",
    ),
  arg: z
    .unknown()
    .optional()
    .describe(
      "Optional JSON-serialisable argument passed to `run()` as argv[0]. Defaults to `{}`.",
    ),
});
export type RunJxaScriptInput = z.infer<typeof runJxaScriptInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface RunJxaScriptContext {
  adapter: OmniFocusAdapter;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  /** Override the audit logger in tests; production uses the module singleton. */
  logger?: Pick<Logger, "info">;
}

/**
 * Pure handler — callable directly in unit tests.
 *
 * @throws {ValidationError} if the adapter does not expose `runJxaScript`
 *   (e.g. `OMNIFOCUS_ALLOW_RAW_SCRIPT` wasn't set at server start).
 */
export async function handleRunJxaScript(input: RunJxaScriptInput, ctx: RunJxaScriptContext) {
  if (typeof ctx.adapter.runJxaScript !== "function") {
    throw new ValidationError("run_jxa_script is not available in this adapter configuration", {
      details: { reason: "raw-script-unavailable" },
      suggestion: "Start the server with OMNIFOCUS_ALLOW_RAW_SCRIPT=1 to enable raw-script tools.",
    });
  }

  const log = ctx.logger ?? defaultLogger;
  log.info(
    {
      event: "raw_script.invoked",
      tool: "run_jxa_script",
      scriptLength: input.script.length,
      script: input.script,
    },
    "raw JXA script invoked",
  );

  const result = await ctx.adapter.runJxaScript(input.script, input.arg);
  return ok(
    { result },
    ctx.makeMeta({ syncPending: true, humanReadableSummary: "Ran JXA script." }),
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface RunJxaScriptRegistrationOptions {
  /** When false (default), the tool is not registered — see ADR-0004. */
  allowRawScript: boolean;
}

/**
 * Registers the `run_jxa_script` tool ONLY when `allowRawScript` is true.
 * Returns the tool handle on registration, `null` when skipped.
 */
export function registerRunJxaScriptTool(
  server: McpServer,
  ctx: RunJxaScriptContext,
  opts: RunJxaScriptRegistrationOptions,
) {
  if (!opts.allowRawScript) return null;
  return server.registerTool(
    "run_jxa_script",
    { description: RUN_JXA_SCRIPT_DESCRIPTION, inputSchema: runJxaScriptInputSchema.shape },
    async (args: RunJxaScriptInput) => {
      const envelope = await handleRunJxaScript(args, ctx);
      return toolResponse(envelope);
    },
  );
}
