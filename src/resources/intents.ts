/**
 * `omnifocus://intents` MCP resource — eighty tools, eight verbs.
 *
 * Returns a curated map from human-style user phrases to canonical tool /
 * prompt / resource sequences. Agents read this on session start (or when
 * uncertain which tool to use) and use it as a routing table.
 *
 * The agent is **not** constrained by this resource — it's a fallback for
 * ambiguity, not a gatekeeper.
 *
 * Cache: 24h TTL — content rarely changes mid-session and the read is cheap.
 *
 * @see #495 — initial implementation
 * @see #491 — NL-excellence epic
 * @see src/resources/intents.data.ts — curated content
 * @see DESIGN.md "NL excellence layer — intents"
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { INTENTS, type Intent } from "./intents.data.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INTENTS_URI = "omnifocus://intents";

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/** Shape returned by `omnifocus://intents`. */
export interface IntentsPayload {
  /** All curated intents, ordered by category then frequency. */
  intents: readonly Intent[];
  /** Total count — convenience for agents that want a quick `intents.length`. */
  count: number;
  /** ISO-8601 generation timestamp; agents may cache against this. */
  generatedAt: string;
}

/** Build the intents payload. Pure — `now` is injectable for tests. */
export function buildIntentsPayload(now: Date = new Date()): IntentsPayload {
  return {
    intents: INTENTS,
    count: INTENTS.length,
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerIntentsResource(server: McpServer): void {
  server.registerResource(
    "omnifocus-intents",
    INTENTS_URI,
    {
      description:
        "Curated routing table mapping human-style user phrases to canonical tool / prompt / resource sequences. " +
        "Eighty registered tools, eight verbs (capture, plan, review, triage, retrospect, share, audit, automate). " +
        "Read at session start — or when uncertain which tool fits the user's intent — to discover obvious paths. " +
        "The agent is NOT constrained by this resource; it's a fallback for ambiguity, not a gatekeeper. " +
        "Each intent has a phrase, aliases, a one-sentence description in the user's voice, and an ordered sequence " +
        "of steps (tool calls, prompts, or resource reads). Steps may carry template `args` placeholders the agent fills. " +
        "Read-only.",
      mimeType: "application/json",
    },
    async (_uri) => ({
      contents: [
        {
          uri: INTENTS_URI,
          mimeType: "application/json",
          text: JSON.stringify(buildIntentsPayload(), null, 2),
        },
      ],
    }),
  );
}
