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
import type { ServiceCacheStats } from "../../cache/lruCache.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ResponseStatsSnapshot } from "../../observability/responseStats.js";
import type { Capabilities } from "../../resources/capabilities.js";
import { probeCalendarAccess } from "../../resources/capabilities.js";
import type { CircuitState } from "../../server/circuitBreaker.js";
import { type MutationScoreSnapshot, probeMutationScore } from "./mutationScore.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const INTERNAL_STATUS_DESCRIPTION =
  "Return a health snapshot of the running omnifocus-mcp server. " +
  "Do NOT use this to read OmniFocus data — prefer task_list, project_list, sync_status, etc. " +
  "Returns { uptimeMs, ofRunning, lastSync, calendarAccess, mutation, cache, circuits, queueDepth, responseStats, stores }. " +
  "cache.services maps key prefixes (tag, folder, forecast, task, project) to { hits, misses, hitRate }. " +
  "uptimeMs is the milliseconds since the server process started. " +
  "circuits lists each circuit-breaker name and state (closed/open/half_open). " +
  "lastSync mirrors sync_status data; null if getLastSync throws. " +
  "calendarAccess reports the macOS Calendar bridge state — { available, permission } where " +
  "available is true when the Swift binary is callable and permission is the live EventKit " +
  "authorization status (granted | denied | restricted | not-determined), or 'unknown' when " +
  "available is false. Read-only — does NOT trigger the macOS Calendar TCC prompt. " +
  "mutation surfaces Stryker calibration freshness — { score, lastRunAt } where score is the " +
  "latest mutation-testing score (0–100) per ADR-0017 and lastRunAt is the report's mtime. " +
  "Returns null when no report file is present (the published npm tarball ships without one). " +
  "responseStats reports per-tool response-byte aggregates (#778) — " +
  "{ since, sampleRate, thresholdBytes, tools: { <toolName>: { count, total, max, p50, p95 } } } — " +
  "or null when sampling is disabled (sampleRate 0). " +
  "stores: { idempotencyEntries, loopDetectorKeys } live retention-store sizes — null when not wired. " +
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

/** Current sizes of bounded in-process retention stores (#813). */
export interface StoresSizeSnapshot {
  /** Number of live entries in the idempotency LRU (cap: env OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES, default 1024). */
  idempotencyEntries: number;
  /** Number of distinct (tool, args-hash) keys in the loop-detector window map (cap: env OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS, default 4096). */
  loopDetectorKeys: number;
}

export interface InternalStatusData {
  uptimeMs: number;
  ofRunning: boolean;
  lastSync: { lastSyncAt: string | null; inFlight: boolean } | null;
  /**
   * macOS Calendar bridge state (per ADR-0018). `null` when the probe throws
   * for an unexpected reason — callers should treat that as "unknown" without
   * failing the whole status read.
   */
  calendarAccess: Capabilities["calendarAccess"] | null;
  /**
   * Stryker mutation-testing calibration freshness (per ADR-0017). `null` when
   * no `reports/mutation/mutation.json` is present — published npm tarballs do
   * not ship the report, so end-user installs degrade to `null` cleanly.
   */
  mutation: MutationScoreSnapshot | null;
  /**
   * Aggregate cache stats plus per-service hit/miss breakdown (#821).
   * `null` when no cache is wired.
   */
  cache: {
    size: number;
    hits: number;
    misses: number;
    evictions: number;
    coalesced: number;
    services: Record<string, ServiceCacheStats>;
  } | null;
  circuits: CircuitSnapshot[];
  queueDepth: number | null;
  /**
   * Per-tool response-byte aggregates (#778). `null` when telemetry is
   * disabled (sample rate 0) — that's the production default. Operators
   * opt in by setting `OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE`.
   */
  responseStats: ResponseStatsSnapshot | null;
  /**
   * Current sizes of bounded in-process stores (#813). `null` when the
   * probe is not wired (e.g. in unit tests that only supply minimal context).
   */
  stores: StoresSizeSnapshot | null;
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
  /**
   * Override the calendar-access probe. Defaults to `probeCalendarAccess()`,
   * which spawns the Swift bridge and degrades cleanly when it isn't built.
   */
  probeCalendarAccess?: () => Promise<Capabilities["calendarAccess"]>;
  /**
   * Override the mutation-score probe. Defaults to `probeMutationScore()`,
   * which reads the latest Stryker report and degrades to `null` when absent.
   */
  probeMutationScore?: () => MutationScoreSnapshot | null;
  /**
   * Optional response-stats probe (#778). Returns the current snapshot, or
   * `null` to indicate telemetry is disabled. Omitting the probe entirely
   * also surfaces as `null` in the response.
   */
  probeResponseStats?: () => ResponseStatsSnapshot | null;
  /**
   * Optional cache-stats probe (#821). Returns aggregate + per-service stats,
   * or `null` when no cache is wired. Omitting also surfaces as `null`.
   */
  probeCache?: () => InternalStatusData["cache"];
  /**
   * Optional store-size probe (#813). Returns current entry counts for
   * bounded in-process stores. Omitting surfaces as `null` in the response.
   */
  probeStores?: () => StoresSizeSnapshot;
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

  let calendarAccess: Capabilities["calendarAccess"] | null = null;
  try {
    const probe = ctx.probeCalendarAccess ?? probeCalendarAccess;
    calendarAccess = await probe();
  } catch {
    // Unexpected probe failure should not block the status read — surface
    // null so the caller knows the field is unavailable rather than wrong.
    calendarAccess = null;
  }

  let mutation: MutationScoreSnapshot | null = null;
  try {
    const probe = ctx.probeMutationScore ?? probeMutationScore;
    mutation = probe();
  } catch {
    mutation = null;
  }

  let responseStats: ResponseStatsSnapshot | null = null;
  if (ctx.probeResponseStats !== undefined) {
    try {
      responseStats = ctx.probeResponseStats();
    } catch {
      responseStats = null;
    }
  }

  let cache: InternalStatusData["cache"] = null;
  if (ctx.probeCache !== undefined) {
    try {
      cache = ctx.probeCache();
    } catch {
      cache = null;
    }
  }

  let stores: StoresSizeSnapshot | null = null;
  if (ctx.probeStores !== undefined) {
    try {
      stores = ctx.probeStores();
    } catch {
      stores = null;
    }
  }

  const data: InternalStatusData = {
    uptimeMs,
    ofRunning: true,
    lastSync,
    calendarAccess,
    mutation,
    cache,
    circuits,
    queueDepth: null,
    responseStats,
    stores,
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
