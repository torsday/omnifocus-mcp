/**
 * `repetition_from_prose` MCP tool — deterministic prose-to-rule helper.
 *
 * Domain-specific NL helper, the first of an `<domain>_from_prose` family.
 * No model calls inside the tool — pure regex/lexer/grammar pipeline. The
 * agent keeps doing prose; the MCP shapes the target schema where it's
 * silently-wrong-when-misencoded by an LLM.
 *
 * Returns one of three discriminated shapes:
 *   - `ok` — a single canonical rule + a normalized description for confirm
 *   - `ambiguous` — multiple valid readings; agent picks one with the user
 *   - `error` — `no-repetition-detected` or `unsupported-pattern`
 *
 * No side effects. Pairs with `task_set_repetition` / `task_create`: the
 * agent calls this tool, presents `normalizedDescription` to the user, and
 * on confirm embeds the returned `rule` in the next write.
 *
 * @see #487 — initial implementation
 * @see src/domain/repetitionGrammar.ts — the parser
 * @see DESIGN.md "Domain-specific NL helpers"
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { parseRepetitionFromProse } from "../../domain/repetitionGrammar.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const REPETITION_FROM_PROSE_DESCRIPTION =
  "Deterministic prose-to-RepetitionRule helper. Pass a natural-language phrase " +
  "('every Monday', 'every 3 days', 'first Tuesday of every month') and receive " +
  "a structured RepetitionRule plus a normalized description to confirm with the user. " +
  "Returns one of three shapes: { kind: 'ok', rule, normalizedDescription } when the " +
  "prose maps to one rule; { kind: 'ambiguous', interpretations[] } when prose admits " +
  "multiple valid readings (typically 2-3) — agent picks one with the user; " +
  "{ kind: 'error', reason, suggestion? } for no-repetition-detected or unsupported-pattern. " +
  "Supported patterns: daily/weekly/monthly/yearly, every-N-days/weeks/months/years, " +
  "every weekday/weekend, every {Mon|Tue|...}, nth-weekday-of-month, nth-day-of-month, " +
  "completion-relative phrasing ('after I complete it'). " +
  "Time-of-day and end-conditions surface in normalizedDescription only — the canonical " +
  "RepetitionRule schema doesn't carry those fields. " +
  "Do NOT use this tool when the agent already has a structured RepetitionRule from " +
  "another source — call task_set_repetition directly instead. Prefer this helper over " +
  "ad-hoc LLM translation whenever the user's repetition phrasing is the only signal. " +
  "No model calls; no side effects. Use with task_set_repetition or task_create. " +
  'Example: repetition_from_prose({ prose: "every Monday" }) ' +
  'Example: repetition_from_prose({ prose: "every 3 days after I complete it" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const repetitionFromProseInputSchema = z.object({
  prose: z
    .string()
    .min(1)
    .describe(
      "Natural-language phrase describing a repetition cadence. " +
        "Examples: 'every Monday', 'every other Tuesday at 10am', " +
        "'first Thursday of every month after I complete it'.",
    ),
  anchor: z
    .object({
      dueDate: z.string().optional().describe("Optional ISO-8601 due-date anchor."),
      deferDate: z.string().optional().describe("Optional ISO-8601 defer-date anchor."),
    })
    .optional()
    .describe(
      "Optional date anchor — currently informational. The grammar reads time-of-day " +
        "from prose into normalizedDescription; embedding it into a date is the agent's " +
        "responsibility once it has anchor context.",
    ),
});

type RepetitionFromProseInput = z.infer<typeof repetitionFromProseInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface RepetitionFromProseContext {
  makeMeta: () => ResponseMeta;
}

export async function handleRepetitionFromProse(
  input: RepetitionFromProseInput,
  ctx: RepetitionFromProseContext,
) {
  const result = parseRepetitionFromProse(input.prose);
  const meta = ctx.makeMeta();
  return ok(result, meta);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerRepetitionFromProseTool(
  server: McpServer,
  ctx: RepetitionFromProseContext,
) {
  return server.registerTool(
    "repetition_from_prose",
    {
      description: REPETITION_FROM_PROSE_DESCRIPTION,
      inputSchema: repetitionFromProseInputSchema.shape,
    },
    async (args: RepetitionFromProseInput) => {
      const envelope = await handleRepetitionFromProse(args, ctx);
      return toolResponse(envelope);
    },
  );
}
