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
  /** Non-fatal issues the agent should see inline (e.g. zod refinement warnings). */
  warnings?: string[];
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
