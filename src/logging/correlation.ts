/**
 * Per-request correlation-ID context for omnifocus-mcp.
 *
 * Each MCP tool call runs inside a `withCorrelationId` scope. Code anywhere
 * in the call stack can read the current ID via `getCorrelationId()` without
 * threading it through every function argument.
 *
 * IDs are ULIDs — lexicographically sortable, collision-resistant, and
 * easy to grep in logs. If the MCP client supplies its own correlation ID
 * (via request meta), we reuse it so client and server logs align.
 *
 * @see DESIGN.md §21 — observability contract (correlation)
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ulid } from "ulid";

const storage = new AsyncLocalStorage<string>();

/**
 * Run `fn` in a new correlation-ID scope.
 *
 * If `incomingId` is provided (non-empty string), it is reused; otherwise a
 * fresh ULID is generated. The ID is available inside `fn` via
 * `getCorrelationId()`.
 */
export function withCorrelationId<T>(fn: () => T, incomingId?: string): T {
  const id = incomingId?.trim() ? incomingId.trim() : ulid();
  return storage.run(id, fn);
}

/**
 * Return the current correlation ID, or `undefined` if called outside a
 * `withCorrelationId` scope.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

/** Generate a fresh ULID (exposed for callers that need one without a scope). */
export function generateCorrelationId(): string {
  return ulid();
}
