/**
 * `internal_status` MCP tool — return a health snapshot of the running server.
 *
 * Use this to inspect uptime, circuit-breaker states, and last sync status
 * without triggering any OmniFocus operations. Do NOT use this to check task
 * or project data — use task_list, project_list, etc. instead.
 *
 * Read-only; no side effects.
 *
 * @see src/server/circuitBreaker.ts — CircuitBreakerRegistry
 * @see src/tools/sync/status.ts — sync_status (dedicated sync state tool)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { CircuitState } from "../../server/circuitBreaker.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const INTERNAL_STATUS_DESCRIPTION =
  "Return a health snapshot of the running omnifocus-mcp server. " +
  "Do NOT use this to read OmniFocus data — prefer task_list, project_list, sync_status, etc. " +
  "Returns { uptimeMs, ofRunning, lastSync, cache, circuits, queueDepth }. " +
  "uptimeMs is the milliseconds since the server process started. " +
  "circuits lists each circuit-breaker name and state (closed/open/half_open). " +
  "lastSync mirrors sync_status data; null if getLastSync throws. " +
  "Read-only; no side effects. " +
  "Example: internal_status()";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const internalStatusInputSchema = z.object({});
export type InternalStatusInput = z.infer<typeof internalStatusInputSchema>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
}

export interface InternalStatusData {
  uptimeMs: number;
  ofRunning: boolean;
  lastSync: { lastSyncAt: string | null; inFlight: boolean } | null;
  cache: { size: number; hits: number; misses: number } | null;
  circuits: CircuitSnapshot[];
  queueDepth: number | null;
}

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface InternalStatusContext {
  /** Timestamp (Date.now()) when the server process started. */
  startedAt: number;
  adapter: OmniFocusAdapter;
  /** Narrow interface — only the snapshot method is required. */
  circuitRegistry: { snapshot(): Array<{ name: string; state: string }> };
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Pure handler — callable directly in unit tests.
 */
export async function handleInternalStatus(
  _input: InternalStatusInput,
  ctx: InternalStatusContext,
) {
  const uptimeMs = Date.now() - ctx.startedAt;

  let lastSync: { lastSyncAt: string | null; inFlight: boolean } | null = null;
  try {
    const status = await ctx.adapter.getLastSync();
    lastSync = { lastSyncAt: status.lastSyncAt, inFlight: status.inFlight };
  } catch {
    // getLastSync failing should not prevent the status tool from responding.
    lastSync = null;
  }

  const circuits = ctx.circuitRegistry.snapshot() as CircuitSnapshot[];

  const data: InternalStatusData = {
    uptimeMs,
    ofRunning: true,
    lastSync,
    cache: null,
    circuits,
    queueDepth: null,
  };

  return ok(data, ctx.makeMeta());
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerInternalStatusTool(server: McpServer, ctx: InternalStatusContext) {
  return server.registerTool(
    "internal_status",
    { description: INTERNAL_STATUS_DESCRIPTION, inputSchema: internalStatusInputSchema.shape },
    async (args: InternalStatusInput) => {
      const envelope = await handleInternalStatus(args, ctx);
      return toolResponse(envelope);
    },
  );
}
