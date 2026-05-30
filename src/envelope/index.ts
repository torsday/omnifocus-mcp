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

import type { Hint } from "../domain/hints.js";
import type { OmniFocusError, SerializedError } from "../errors/index.js";

export type { Hint } from "../domain/hints.js";

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
 * | `WARN_UNKNOWN_FIELDS`  | `fields[]` projection contained unrecognized names   | `{ unknown: string[], allowed: string[] }` |
 */
export type WarningCode =
  | "WARN_IDS_NOT_FOUND"
  | "WARN_RESULT_TRUNCATED"
  | "WARN_SYNC_PENDING"
  | "WARN_DEPRECATED_FIELD"
  | "WARN_DRY_RUN"
  | "WARN_LOOP_DETECTED"
  | "WARN_UNKNOWN_FIELDS";

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

/**
 * Build a `WARN_RESULT_TRUNCATED` warning when a `maxOutputBytes` cap trims a
 * list response (#776). Reuses the existing code — `WARN_RESULT_TRUNCATED`
 * covers a hard size *or* count ceiling — with byte-oriented detail.
 */
export function warnResultTruncatedBytes(bytesReturned: number, itemsReturned: number): Warning {
  return {
    code: "WARN_RESULT_TRUNCATED",
    message: `Response was truncated at the maxOutputBytes cap; returned ${itemsReturned} item(s) (${bytesReturned} bytes).`,
    suggestion: "Fetch the next page with the returned pagination cursor, or raise maxOutputBytes.",
    details: { bytesReturned, itemsReturned },
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

/**
 * Build a `WARN_UNKNOWN_FIELDS` warning when a `fields[]` projection contains
 * names the tool does not recognize. Unknown names are silently dropped from
 * the projection rather than erroring out — robust to LLM misspellings.
 */
export function warnUnknownFields(unknown: string[], allowed: readonly string[]): Warning {
  return {
    code: "WARN_UNKNOWN_FIELDS",
    message: `Unknown field name(s) in fields[] projection: ${unknown.join(", ")}.`,
    suggestion: `Allowed fields: ${[...allowed].sort().join(", ")}.`,
    details: { unknown, allowed: [...allowed] },
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
   * True when a `maxOutputBytes` cap trimmed this list response before its
   * natural page boundary (#776). When set, `pagination.cursor` resumes at the
   * first dropped item. Absent on uncapped responses.
   */
  truncatedAtCap?: boolean;
  /**
   * Serialized wire size (bytes) of the returned data array, present only when a
   * `maxOutputBytes` cap was applied (paired with `truncatedAtCap`). Absent otherwise.
   */
  bytesReturned?: number;
  /**
   * Number of items returned after a `maxOutputBytes` cap was applied (paired
   * with `truncatedAtCap`). Absent otherwise.
   */
  itemsReturned?: number;
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
  /**
   * Server-generated one-liner summarizing what just happened. English; ≤ 140 chars;
   * past tense, active voice ("Created…", "Updated…"). Present on every write tool;
   * absent on reads. Deterministic and template-based — no model calls.
   * Agents may display it verbatim but MUST NOT parse it for state; `data` is authoritative.
   *
   * @see ADR-0015 §3 — humanReadableSummary spec
   */
  humanReadableSummary?: string;
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
  /**
   * Optional server-suggested follow-ups. Purely advisory — the agent is
   * free to ignore them with zero side effects. Absent (not `[]`) when the
   * tool has no hints to offer. See ADR-0015 and `src/domain/hints.ts`.
   */
  hints?: Hint[];
}

/** Failure envelope — the shape every tool returns on error. */
export interface ToolError {
  error: SerializedError;
  meta: ResponseMeta;
}

// ---------------------------------------------------------------------------
// Public contract — ClarificationNeeded (ADR-0015)
// ---------------------------------------------------------------------------

/**
 * A pre-validated, agent-renderable choice in a `clarification-needed` response.
 *
 * Agents MUST present all options verbatim to the user — they must never
 * silently auto-pick option 0 without user contact (see lint guidance #489).
 */
export interface ClarificationOption {
  /** Zero-based index passed as `choice` when calling `clarify`. */
  index: number;
  /** Human-readable label rendered verbatim to the user. */
  label: string;
}

/**
 * Third envelope kind — emitted when a tool cannot resolve ambiguity
 * deterministically and needs user input before proceeding.
 *
 * Agent contract:
 * 1. Render `question` and `options` to the user.
 * 2. Call the `clarify` tool with `{ replayToken, choice }` using the index
 *    of the option the user selected.
 * 3. The server replays the original tool with the disambiguation applied.
 *
 * `partial` carries the args the user already supplied unambiguously so the
 * agent's next call doesn't have to reconstruct them (the `clarify` tool
 * handles reconstruction internally via the replay store).
 *
 * `replayToken` is opaque, expires in 5 minutes, and is single-use.
 * Agents must NOT persist or cache tokens across sessions.
 *
 * @see ADR-0015 — three-kind envelope
 * @see src/tools/clarify.ts — `clarify` dispatcher tool
 * @see src/state/replayStore.ts — token store
 */
export interface ClarificationNeeded {
  kind: "clarification-needed";
  /** Question the agent renders verbatim to the user. */
  question: string;
  /**
   * Pre-validated choices the agent renders verbatim. Absent only when the
   * clarification is open-ended (rare — prefer options when feasible).
   */
  options?: ClarificationOption[];
  /**
   * The unambiguous args the user already supplied. Informational only —
   * the replay store handles re-invocation.
   */
  partial?: Record<string, unknown>;
  /** Opaque server-issued token. Pass to `clarify` with the chosen index. */
  replayToken: string;
  meta: ResponseMeta;
}

/** Either success, failure, or clarification-needed. */
export type ToolEnvelope<T> = ToolSuccess<T> | ToolError | ClarificationNeeded;

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
/**
 * Wrap a success payload in the standard envelope.
 *
 * @param data — tool-specific payload
 * @param meta — request-scoped metadata from the handler harness
 * @param pagination — optional pagination block for list-shaped responses
 * @param hints — optional server-suggested follow-ups (see ADR-0015)
 * @returns a `ToolSuccess<T>` matching the ADR-0013/ADR-0015 contract
 */
export function ok<T>(
  data: T,
  meta: ResponseMeta,
  pagination?: Pagination,
  hints?: Hint[],
): ToolSuccess<T> {
  const envelope: ToolSuccess<T> = { data, meta };
  if (pagination !== undefined) envelope.pagination = pagination;
  if (hints !== undefined && hints.length > 0) envelope.hints = hints;
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

/**
 * Build a `clarification-needed` envelope.
 *
 * @param question - Rendered verbatim to the user by the agent.
 * @param replayToken - Opaque token from the replay store.
 * @param meta - Request-scoped metadata (same as for `ok`).
 * @param options - Pre-validated choices (highly recommended over open-ended).
 * @param partial - The unambiguous args already supplied by the user.
 * @returns A `ClarificationNeeded` envelope matching the ADR-0015 contract.
 */
export function clarificationNeeded(
  question: string,
  replayToken: string,
  meta: ResponseMeta,
  options?: ClarificationOption[],
  partial?: Record<string, unknown>,
): ClarificationNeeded {
  const envelope: ClarificationNeeded = {
    kind: "clarification-needed",
    question,
    replayToken,
    meta,
  };
  if (options !== undefined && options.length > 0) envelope.options = options;
  if (partial !== undefined && Object.keys(partial).length > 0) envelope.partial = partial;
  return envelope;
}

/** Narrowing guard for consumers that see `ToolEnvelope<T>` and need to branch. */
export function isSuccess<T>(envelope: ToolEnvelope<T>): envelope is ToolSuccess<T> {
  return "data" in envelope;
}

/** Complement of `isSuccess` for symmetry. */
export function isError<T>(envelope: ToolEnvelope<T>): envelope is ToolError {
  return "error" in envelope;
}

/** Narrowing guard for `clarification-needed` envelopes. */
export function isClarificationNeeded<T>(
  envelope: ToolEnvelope<T>,
): envelope is ClarificationNeeded {
  return "kind" in envelope && (envelope as ClarificationNeeded).kind === "clarification-needed";
}

/**
 * Placeholder `content[].text` body used by `toolResponse` in v2.0.0+.
 *
 * v1.x duplicated the full envelope JSON in both `content[].text` AND
 * `structuredContent`. Per ADR-0022 (see `docs/adr/0022-envelope-text-content-duplication.md`)
 * v2 emits this small fixed marker by default — clients should read
 * `structuredContent`. Setting `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` restores
 * v1 behavior for callers that can't migrate yet.
 *
 * ADR-0022 commits to this exact string; renaming it is itself breaking.
 */
export const PLACEHOLDER_CONTENT_TEXT = "see structuredContent";

/**
 * Read once at module load — matches the OMNIFOCUS_* flag pattern in
 * `src/config/env.ts`. Server-start-only by design; the env var does not
 * re-read between calls.
 */
const LEGACY_TEXT_CONTENT = process.env.OMNIFOCUS_LEGACY_TEXT_CONTENT === "1";

/**
 * Wrap a `ToolEnvelope` in the `{ content, structuredContent }` shape the MCP
 * SDK expects from a `registerTool` callback. Every tool returns the same pair:
 * a small `text` placeholder for agents that only parse `content`, and the
 * raw envelope under `structuredContent` for clients that use the typed shape.
 *
 * **v2.0.0 breaking change** (ADR-0022): `content[].text` no longer duplicates
 * the envelope JSON. Set `OMNIFOCUS_LEGACY_TEXT_CONTENT=1` to restore the v1
 * shape. `structuredContent` is unchanged.
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
    content: [
      {
        type: "text" as const,
        text: LEGACY_TEXT_CONTENT ? JSON.stringify(envelope) : PLACEHOLDER_CONTENT_TEXT,
      },
    ],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}
