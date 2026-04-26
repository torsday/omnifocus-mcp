/**
 * Response envelope helpers for MCP tool returns.
 *
 * Every tool in this MCP returns a uniform JSON envelope — success as
 * `{ data, meta, pagination? }`, failure as `{ error, meta }`. The helpers
 * here are the only sanctioned way to produce those shapes; a lint rule
 * (issue #78) forbids raw `return { data: ... }` outside these helpers.
 *
 * `ResponseMeta` is required on every response. The handler harness (lands
 * with issue #27) supplies correlationId, durationMs, transport, cacheHit,
 * and ofVersion from request-scoped context. Service methods never construct
 * meta themselves — they return domain payloads and let the harness wrap.
 *
 * @see DESIGN.md §12 — tool response envelope
 * @see DESIGN.md §15 — pagination shape
 * @see docs/adr/0013-tool-response-envelope.md — public contract for this shape
 */

import type { OmniFocusError, SerializedError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Public contract — Warning
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable warning codes. Agents switch on `code` to decide
 * whether to act — the same pattern used for error `remediationClass`.
 *
 * **Additive only.** New codes are minor-version additions; removing a code
 * is a breaking change per ADR-0011.
 *
 * | Code                   | Emitted when                                         | `details` shape                   |
 * |------------------------|------------------------------------------------------|-----------------------------------|
 * | `WARN_IDS_NOT_FOUND`   | Bulk request had unmatched IDs                       | `{ missing: string[] }`           |
 * | `WARN_RESULT_TRUNCATED`| Response hit a hard size/count ceiling               | `{ limit: number }`               |
 * | `WARN_SYNC_PENDING`    | Mutation saved locally; OF hasn't synced             | —                                 |
 * | `WARN_DEPRECATED_FIELD`| Caller used a deprecated input field                 | `{ field: string, replacement: string }` |
 * | `WARN_DRY_RUN`         | Response is hypothetical; no write occurred          | —                                 |
 * | `WARN_LOOP_DETECTED`   | Same tool+args called ≥5× within 60s                | `{ tool: string, count: number, windowSeconds: number }` |
 */
export type WarningCode =
  | "WARN_IDS_NOT_FOUND"
  | "WARN_RESULT_TRUNCATED"
  | "WARN_SYNC_PENDING"
  | "WARN_DEPRECATED_FIELD"
  | "WARN_DRY_RUN"
  | "WARN_LOOP_DETECTED";

/**
 * Structured non-fatal issue that the agent should see inline.
 *
 * Replaces the previous `string[]` shape so agents can act programmatically
 * on warnings rather than parsing English. Mirrors the error hierarchy
 * convention: stable `code`, optional `suggestion`, optional `details`.
 *
 * @see DESIGN.md §34 — agent ergonomics
 */
export interface Warning {
  /** Stable machine-readable code — agents switch on this. */
  code: WarningCode;
  /** English description of the condition. */
  message: string;
  /** Recommended agent action — same convention as `error.suggestion`. */
  suggestion?: string;
  /** Per-code structured payload (e.g. `{ missing: string[] }` for WARN_IDS_NOT_FOUND). */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Warning builder helpers
// ---------------------------------------------------------------------------

/** Build a `WARN_IDS_NOT_FOUND` warning for bulk-fetch tools. */
export function warnIdsNotFound(missing: string[]): Warning {
  return {
    code: "WARN_IDS_NOT_FOUND",
    message: `${missing.length} requested ID(s) were not found and have been omitted.`,
    suggestion: "Verify the IDs are correct and that the items have not been deleted.",
    details: { missing },
  };
}

/** Build a `WARN_RESULT_TRUNCATED` warning when a hard ceiling is hit. */
export function warnResultTruncated(limit: number): Warning {
  return {
    code: "WARN_RESULT_TRUNCATED",
    message: `Results were truncated at the hard ceiling of ${limit} items.`,
    suggestion: "Use cursor pagination or add filters to narrow the result set.",
    details: { limit },
  };
}

/** Build a `WARN_SYNC_PENDING` warning on mutation responses. */
export function warnSyncPending(): Warning {
  return {
    code: "WARN_SYNC_PENDING",
    message: "Changes have been saved locally but OmniFocus has not yet synced to Omni Sync.",
    suggestion: "Call sync_trigger if you need to confirm propagation to other devices.",
  };
}

/** Build a `WARN_DEPRECATED_FIELD` warning when a deprecated field is detected. */
export function warnDeprecatedField(field: string, replacement: string): Warning {
  return {
    code: "WARN_DEPRECATED_FIELD",
    message: `Input field "${field}" is deprecated and will be removed in a future version.`,
    suggestion: `Use "${replacement}" instead.`,
    details: { field, replacement },
  };
}

/** Build a `WARN_DRY_RUN` warning on hypothetical responses. */
export function warnDryRun(): Warning {
  return {
    code: "WARN_DRY_RUN",
    message: "This response is hypothetical — no write was performed (dry_run: true).",
    suggestion: "Remove dry_run or set it to false to commit the change.",
  };
}

// ---------------------------------------------------------------------------
// Public contract — envelope types
// ---------------------------------------------------------------------------

/** Which layer produced the response. Useful for debugging and cache analysis. */
export type Transport = "jxa" | "omnijs" | "cache" | "memory";

/**
 * Metadata carried on every response — success or error. Populated by the
 * handler harness from per-request context. Every field here is part of the
 * public stability contract (ADR-0011).
 */
export interface ResponseMeta {
  /** ULID per MCP request. Echoed to logs for cross-event correlation. */
  correlationId: string;
  /** Wall-clock milliseconds from tool entry to envelope construction. */
  durationMs: number;
  /** True if this response was served without calling OmniFocus (cache hit or in-memory adapter). */
  cacheHit: boolean;
  /** The adapter path that produced this response. */
  transport: Transport;
  /** The OmniFocus version the adapter observed, e.g. `"4.5.2"`. `"unknown"` on cold path. */
  ofVersion: string;
  /**
   * True on any mutation response when the server has made writes not yet pushed to Omni Sync.
   * Always false (or absent) on read-only responses. Agents use this to decide when to call
   * `sync_trigger` rather than relying on documentation alone.
   */
  syncPending?: boolean;
  /**
   * Structured non-fatal issues the agent should see inline.
   * Each entry has a stable `code` agents can switch on — see `Warning`.
   */
  warnings?: Warning[];
  /**
   * Current rate-limit window state for this tool. Absent on cached responses
   * (no rate check was performed). Present on live calls and on RateLimited errors
   * (remaining: 0). Agents: if remaining < 10, add a short delay between calls.
   */
  rateLimit?: {
    /** Calls remaining in the current window for this tool. */
    remaining: number;
    /** ISO-8601 timestamp when the current window resets. */
    resetAt: string;
  };
  /**
   * True when this response is a replay of a previously computed envelope
   * under an idempotency key (see `withIdempotencyKey`). Absent on fresh
   * responses. Agents use this to distinguish a cached replay from new work.
   */
  idempotentReplay?: boolean;
  /**
   * True when this response is a dry-run preview — input validation ran but
   * no OmniFocus mutation was performed (see `dryRunGuard`). Absent on live
   * mutations and on reads. Server-populated fields like `id`, `createdAt`,
   * and `modifiedAt` will be `null` in preview payloads.
   *
   * @see DESIGN.md §31 — dry-run mode
   */
  dryRun?: boolean;
}

/**
 * Pagination block present on list-shaped tools. `cursor: null` means
 * "no more results." `total` is omitted when computing it would double
 * the cost of the read.
 */
export interface Pagination {
  cursor: string | null;
  hasMore: boolean;
  total?: number;
}

/** Success envelope — the shape every non-list tool returns on success. */
export interface ToolSuccess<T> {
  data: T;
  meta: ResponseMeta;
  pagination?: Pagination;
}

/** Failure envelope — the shape every tool returns on error. */
export interface ToolError {
  error: SerializedError;
  meta: ResponseMeta;
}

/** Either success or failure. Discriminated by presence of `data` vs `error`. */
export type ToolEnvelope<T> = ToolSuccess<T> | ToolError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a success payload in the standard envelope.
 *
 * @param data — tool-specific payload (e.g. `{ tasks: Task[] }` for list tools)
 * @param meta — request-scoped metadata from the handler harness
 * @param pagination — optional pagination block for list-shaped responses
 * @returns a `ToolSuccess<T>` matching the ADR-0013 contract
 */
export function ok<T>(data: T, meta: ResponseMeta, pagination?: Pagination): ToolSuccess<T> {
  const envelope: ToolSuccess<T> = { data, meta };
  if (pagination !== undefined) envelope.pagination = pagination;
  return envelope;
}

/**
 * Wrap a typed error in the standard envelope. The caller is responsible
 * for catching at the handler boundary and calling `err()` to produce the
 * wire shape — see agent_systems.md "actionable errors" principle.
 *
 * @param error — any `OmniFocusError` subclass; serialized via its `toJSON()`
 * @param meta — request-scoped metadata; same shape as success meta
 * @returns a `ToolError` matching the ADR-0013 contract
 */
export function err(error: OmniFocusError, meta: ResponseMeta): ToolError {
  return {
    error: error.toJSON(),
    meta,
  };
}

/** Narrowing guard for consumers that see `ToolEnvelope<T>` and need to branch. */
export function isSuccess<T>(envelope: ToolEnvelope<T>): envelope is ToolSuccess<T> {
  return "data" in envelope;
}

/** Complement of `isSuccess` for symmetry. */
export function isError<T>(envelope: ToolEnvelope<T>): envelope is ToolError {
  return "error" in envelope;
}

/**
 * Wrap a `ToolEnvelope` in the `{ content, structuredContent }` shape the MCP
 * SDK expects from a `registerTool` callback. Every tool returns the same pair:
 * a JSON-serialised `text` block for agents that only parse `content`, and the
 * raw envelope under `structuredContent` for clients that use the typed shape.
 *
 * The `as unknown as Record<string, unknown>` cast bridges the SDK's loose
 * structured-content type with our discriminated `ToolSuccess<T> | ToolError`.
 * Keeping it here means the cast exists once, not at every callsite.
 *
 * `ToolEnvelope<unknown>` — not a generic — so a union like
 * `ToolSuccess<{noChange}> | ToolSuccess<{done}>` (task_complete) passes as a
 * single argument without having to unify the payload types.
 */
export function toolResponse(envelope: ToolEnvelope<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}
