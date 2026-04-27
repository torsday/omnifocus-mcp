/**
 * `clarify` MCP tool — replay-token dispatcher for `clarification-needed` responses.
 *
 * When a tool cannot resolve ambiguity deterministically, it stores a callback
 * in the replay store and returns a `clarification-needed` envelope carrying an
 * opaque token. The agent presents the question and options to the user, then
 * calls this tool with `{ replayToken, choice }`. This dispatcher looks up the
 * token, validates the choice, executes the stored callback, and returns the
 * resulting envelope.
 *
 * Single-use: tokens are consumed (deleted) on first successful call. Expired
 * or missing tokens return a descriptive error. The underlying callback returns
 * a `ToolEnvelope` (which may itself be `clarification-needed` for multi-step
 * flows, though this is intentionally rare).
 *
 * @see src/state/replayStore.ts — token store
 * @see src/envelope/index.ts — ClarificationNeeded shape
 * @see ADR-0015 — three-kind envelope
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { err, type ResponseMeta, toolResponse } from "../envelope/index.js";
import { NotFound, ValidationError } from "../errors/index.js";
import { replayStore as defaultReplayStore, type ReplayStore } from "../state/replayStore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const CLARIFY_DESCRIPTION =
  "Replay dispatcher for clarification-needed responses. " +
  "When a tool returns { kind: 'clarification-needed' }, present the question and options " +
  "to the user, then call this tool with the replayToken from that response and the zero-based " +
  "index of the option the user selected. " +
  "The server resumes the original tool call with the disambiguation applied and returns the " +
  "final result envelope. " +
  "Tokens are single-use and expire after 5 minutes — call this tool promptly after the user " +
  "responds. Passing an expired or unknown token returns a NotFound error. " +
  "Passing a choice index outside the valid range returns an InvalidInput error. " +
  'Example: clarify({ replayToken: "tok_abc", choice: 0 })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const clarifyInputSchema = z.object({
  replayToken: z
    .string()
    .min(1)
    .describe("Opaque token from the clarification-needed envelope's replayToken field."),
  choice: z
    .number()
    .int()
    .min(0)
    .describe(
      "Zero-based index of the option the user selected (matches ClarificationOption.index).",
    ),
});

export type ClarifyInput = z.infer<typeof clarifyInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface ClarifyContext {
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
  replayStore?: ReplayStore;
}

export async function handleClarify(input: ClarifyInput, ctx: ClarifyContext) {
  const store = ctx.replayStore ?? defaultReplayStore;
  const meta = ctx.makeMeta();

  const entry = store.consume(input.replayToken);
  if (entry === undefined) {
    return err(
      new NotFound(`Replay token not found or expired: ${input.replayToken.slice(0, 8)}…`, {
        suggestion:
          "The token may have expired (5 min TTL) or already been used. Re-invoke the original tool to get a fresh token.",
      }),
      meta,
    );
  }

  if (input.choice < 0 || input.choice >= entry.options.length) {
    return err(
      new ValidationError(
        `choice ${input.choice} is out of range; valid indices are 0–${entry.options.length - 1}.`,
        {
          suggestion: `Valid options: ${entry.options.map((o, i) => `${i}: ${o}`).join(", ")}.`,
        },
      ),
      meta,
    );
  }

  // Execute the stored callback with the chosen index. The callback returns a
  // ToolEnvelope. We return it as-is — the outer toolResponse wrapper handles
  // both success and error shapes uniformly.
  const result = await entry.callback(input.choice);
  return result;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerClarifyTool(server: McpServer, ctx: ClarifyContext) {
  return server.registerTool(
    "clarify",
    {
      description: CLARIFY_DESCRIPTION,
      inputSchema: clarifyInputSchema.shape,
    },
    async (args: ClarifyInput) => {
      const envelope = await handleClarify(args, ctx);
      return toolResponse(envelope as Parameters<typeof toolResponse>[0]);
    },
  );
}
