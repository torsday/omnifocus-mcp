/**
 * Environment-variable configuration for omnifocus-mcp.
 *
 * All env vars are parsed and validated once at startup. Invalid values exit
 * the process immediately with a readable message on stderr rather than
 * failing at first tool call — see DESIGN §22.
 *
 * Path-shaped values (`OMNIFOCUS_ATTACHMENT_PATHS`) are logged as hashes to
 * avoid leaking directory structure in operator logs — see DESIGN §17.
 *
 * @see DESIGN.md §22 — configuration & environment
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Rate-limit schema — parses "N/SECONDS" format
// ---------------------------------------------------------------------------

const rateLimitSchema = z
  .string()
  .regex(/^\d+\/\d+$/, 'must be "N/SECONDS" format, e.g. "120/60"')
  .transform((s) => {
    const [limit, windowSeconds] = s.split("/").map(Number);
    return { limit: limit as number, windowSeconds: windowSeconds as number };
  });

// ---------------------------------------------------------------------------
// Full config schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  OMNIFOCUS_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  OMNIFOCUS_INTEGRATION: z
    .string()
    .prefault("")
    .transform((v) => v === "1"),
  OMNIFOCUS_E2E: z
    .string()
    .prefault("")
    .transform((v) => v === "1"),
  // ADR-0014 — E2E harness flag. When set, `composeAdapter` returns a
  // TransportRouter backed by the in-memory adapter so the spawned-server
  // E2E suite can invoke every registered tool deterministically without
  // macOS Automation permission. Production callers never set this.
  OMNIFOCUS_E2E_USE_MEMORY: z
    .string()
    .prefault("")
    .transform((v) => v === "1"),
  OMNIFOCUS_ALLOW_RAW_SCRIPT: z
    .string()
    .prefault("")
    .transform((v) => v === "1"),
  OMNIFOCUS_WEBHOOKS_ENABLED: z
    .string()
    .prefault("")
    .transform((v) => v === "1"),
  OMNIFOCUS_CACHE_TTL_MS: z.coerce.number().int().positive().default(30000),
  OMNIFOCUS_CACHE_CAPACITY: z.coerce.number().int().positive().default(256),
  // Total-bytes cap on the read cache (#812). Bounds memory pinned by
  // oversized cached responses (e.g. forecast pages with thousands of
  // full Task objects); evicts oldest when the sum is over the cap,
  // independent of the entry-count cap above. Default 16 MB.
  OMNIFOCUS_READ_CACHE_MAX_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(16 * 1024 * 1024),
  OMNIFOCUS_READ_POOL_SIZE: z.coerce.number().int().min(1).max(8).default(2),
  OMNIFOCUS_WRITE_QUEUE_CAP: z.coerce.number().int().positive().default(50),
  OMNIFOCUS_JXA_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  OMNIFOCUS_OMNIJS_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  // Retry-once on known-transient JXA failures (#816). Applies only to read-only
  // scripts (see READ_ONLY_JXA_SCRIPTS in scriptRunner). Set ENABLED=0 to
  // disable globally; DELAY_MS=0 keeps the retry but skips the backoff sleep.
  OMNIFOCUS_TRANSIENT_RETRY_ENABLED: z
    .string()
    .prefault("1")
    .transform((v) => v !== "0"),
  OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(100),
  OMNIFOCUS_ATTACHMENT_PATHS: z
    .string()
    .prefault(homedir())
    .transform((v) => v.split(":").filter(Boolean)),
  OMNIFOCUS_MAX_ATTACHMENT_MB: z.coerce.number().int().positive().default(100),
  OMNIFOCUS_TOOL_RATE_LIMIT: rateLimitSchema.prefault("120/60"),
  OMNIFOCUS_WAITING_TAG_NAME: z.string().min(1).default("waiting"),
  OMNIFOCUS_TEMPLATES_FOLDER_NAME: z.string().min(1).default("Templates"),
  // Per-tool response-size telemetry (#778). 0 = off (production default,
  // zero overhead); 1 = record every successful tool response. Fractional
  // values sample at that rate. The percentile and threshold readouts surface
  // through `internal_status` and the `response.size.exceeded` warning event.
  OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  // p95 byte threshold above which a `response.size.exceeded` warning fires
  // (once, on the transition above). Default 51200 bytes ≈ ~13k tokens — the
  // rough boundary at which a single response starts to dominate context.
  OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES: z.coerce.number().int().positive().default(51200),
  // Per-transport / per-script latency telemetry (#940). Same gating model
  // as response stats: 0 = off (production default, zero overhead);
  // fractional values sample at that rate; 1 = record every transport.call.
  // Surfaces via `internal_status` and the `latency.exceeded` warning event.
  OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  // p95 millisecond threshold above which a `latency.exceeded` warning fires
  // (once, on the transition above). Default 2000ms — the boundary at which
  // a single script becomes a perceptible interactive-call problem.
  OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS: z.coerce.number().int().positive().default(2000),
  // Hard cap on distinct (tool, args-hash) keys the loop detector tracks
  // simultaneously. When exceeded, the oldest key is evicted (FIFO). Raise
  // if a long-running server legitimately calls many unique arg combos per
  // minute; lower to tighten the memory ceiling. Default 4096. (#813)
  OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS: z.coerce.number().int().positive().default(4096),
});

// ---------------------------------------------------------------------------
// Exported config type
// ---------------------------------------------------------------------------

export type Config = z.output<typeof envSchema>;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate all OMNIFOCUS_* env vars from `processEnv`.
 *
 * On validation failure, writes a human-readable message to `stderr` and
 * exits the process with code 1. Caller may override both for testing.
 */
export function parseConfig(
  processEnv: NodeJS.ProcessEnv = process.env,
  onError: (message: string) => never = (msg) => {
    process.stderr.write(`[omnifocus-mcp] Config error: ${msg}\n`);
    process.exit(1);
  },
): Config {
  const result = envSchema.safeParse({
    OMNIFOCUS_LOG_LEVEL: processEnv.OMNIFOCUS_LOG_LEVEL,
    OMNIFOCUS_INTEGRATION: processEnv.OMNIFOCUS_INTEGRATION,
    OMNIFOCUS_E2E: processEnv.OMNIFOCUS_E2E,
    OMNIFOCUS_E2E_USE_MEMORY: processEnv.OMNIFOCUS_E2E_USE_MEMORY,
    OMNIFOCUS_ALLOW_RAW_SCRIPT: processEnv.OMNIFOCUS_ALLOW_RAW_SCRIPT,
    OMNIFOCUS_WEBHOOKS_ENABLED: processEnv.OMNIFOCUS_WEBHOOKS_ENABLED,
    OMNIFOCUS_CACHE_TTL_MS: processEnv.OMNIFOCUS_CACHE_TTL_MS,
    OMNIFOCUS_CACHE_CAPACITY: processEnv.OMNIFOCUS_CACHE_CAPACITY,
    OMNIFOCUS_READ_CACHE_MAX_BYTES: processEnv.OMNIFOCUS_READ_CACHE_MAX_BYTES,
    OMNIFOCUS_READ_POOL_SIZE: processEnv.OMNIFOCUS_READ_POOL_SIZE,
    OMNIFOCUS_WRITE_QUEUE_CAP: processEnv.OMNIFOCUS_WRITE_QUEUE_CAP,
    OMNIFOCUS_JXA_TIMEOUT_MS: processEnv.OMNIFOCUS_JXA_TIMEOUT_MS,
    OMNIFOCUS_OMNIJS_TIMEOUT_MS: processEnv.OMNIFOCUS_OMNIJS_TIMEOUT_MS,
    OMNIFOCUS_TRANSIENT_RETRY_ENABLED: processEnv.OMNIFOCUS_TRANSIENT_RETRY_ENABLED,
    OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: processEnv.OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS,
    OMNIFOCUS_ATTACHMENT_PATHS: processEnv.OMNIFOCUS_ATTACHMENT_PATHS,
    OMNIFOCUS_MAX_ATTACHMENT_MB: processEnv.OMNIFOCUS_MAX_ATTACHMENT_MB,
    OMNIFOCUS_TOOL_RATE_LIMIT: processEnv.OMNIFOCUS_TOOL_RATE_LIMIT,
    OMNIFOCUS_WAITING_TAG_NAME: processEnv.OMNIFOCUS_WAITING_TAG_NAME,
    OMNIFOCUS_TEMPLATES_FOLDER_NAME: processEnv.OMNIFOCUS_TEMPLATES_FOLDER_NAME,
    OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE: processEnv.OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE,
    OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES: processEnv.OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES,
    OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE: processEnv.OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE,
    OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS: processEnv.OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS,
    OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS: processEnv.OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS,
  });

  if (!result.success) {
    const lines = result.error.issues.map((e) => `  ${e.path.join(".")}: ${e.message}`);
    return onError(
      `Invalid environment configuration:\n${lines.join("\n")}\nSee DESIGN §22 for allowed values.`,
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Redacted summary for the server.started event log
// ---------------------------------------------------------------------------

/** Hash a string value for safe inclusion in logs. */
function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Return a redacted view of the config safe to emit in structured logs.
 * Path-shaped values are replaced with a short hash.
 */
export function redactConfig(config: Config): Record<string, unknown> {
  return {
    OMNIFOCUS_LOG_LEVEL: config.OMNIFOCUS_LOG_LEVEL,
    OMNIFOCUS_INTEGRATION: config.OMNIFOCUS_INTEGRATION,
    OMNIFOCUS_E2E: config.OMNIFOCUS_E2E,
    OMNIFOCUS_E2E_USE_MEMORY: config.OMNIFOCUS_E2E_USE_MEMORY,
    OMNIFOCUS_ALLOW_RAW_SCRIPT: config.OMNIFOCUS_ALLOW_RAW_SCRIPT,
    OMNIFOCUS_WEBHOOKS_ENABLED: config.OMNIFOCUS_WEBHOOKS_ENABLED,
    OMNIFOCUS_CACHE_TTL_MS: config.OMNIFOCUS_CACHE_TTL_MS,
    OMNIFOCUS_CACHE_CAPACITY: config.OMNIFOCUS_CACHE_CAPACITY,
    OMNIFOCUS_READ_CACHE_MAX_BYTES: config.OMNIFOCUS_READ_CACHE_MAX_BYTES,
    OMNIFOCUS_READ_POOL_SIZE: config.OMNIFOCUS_READ_POOL_SIZE,
    OMNIFOCUS_WRITE_QUEUE_CAP: config.OMNIFOCUS_WRITE_QUEUE_CAP,
    OMNIFOCUS_JXA_TIMEOUT_MS: config.OMNIFOCUS_JXA_TIMEOUT_MS,
    OMNIFOCUS_OMNIJS_TIMEOUT_MS: config.OMNIFOCUS_OMNIJS_TIMEOUT_MS,
    OMNIFOCUS_TRANSIENT_RETRY_ENABLED: config.OMNIFOCUS_TRANSIENT_RETRY_ENABLED,
    OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: config.OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS,
    // Path-shaped — hash each entry to avoid leaking directory structure
    OMNIFOCUS_ATTACHMENT_PATHS: config.OMNIFOCUS_ATTACHMENT_PATHS.map(hashValue),
    OMNIFOCUS_MAX_ATTACHMENT_MB: config.OMNIFOCUS_MAX_ATTACHMENT_MB,
    OMNIFOCUS_TOOL_RATE_LIMIT: config.OMNIFOCUS_TOOL_RATE_LIMIT,
    OMNIFOCUS_WAITING_TAG_NAME: config.OMNIFOCUS_WAITING_TAG_NAME,
    OMNIFOCUS_TEMPLATES_FOLDER_NAME: config.OMNIFOCUS_TEMPLATES_FOLDER_NAME,
    OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE: config.OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE,
    OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES: config.OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES,
    OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE: config.OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE,
    OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS: config.OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS,
    OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS: config.OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS,
  };
}
