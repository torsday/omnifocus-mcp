/**
 * Idempotency primitive for omnifocus-mcp mutation tools.
 *
 * Callers pass an optional `idempotency_key` on mutation tool calls. If the
 * same key is seen again within the TTL window, the stored envelope is
 * returned verbatim (with `meta.idempotentReplay = true`) and the underlying
 * work is not re-executed. Concurrent callers with the same key coalesce onto
 * a single in-flight promise — this is the write-side analogue of the
 * read-cache coalescing shipped in #22.
 *
 * **What is stored.** The full `ToolEnvelope<unknown>` (success or error).
 * Errors are replayed too: if a mutation fails with `InvalidInput`, a retry
 * under the same key returns the same `InvalidInput`. Only transient errors
 * surfaced *before* the user function runs (e.g. store eviction races) are
 * not cached — those are never reached.
 *
 * **Why full envelope, not just `data`.** Errors must replay to preserve the
 * "same key → same outcome" contract. `meta.idempotentReplay` flips to `true`
 * on every replay so agents can distinguish fresh work from replays.
 *
 * **Foundation only.** This module provides the store and the wrapper; no
 * tool surfaces consume it yet. Per-tool adoption lands in follow-up PRs so
 * each tool can prove its mutation is safely coalesce-able.
 *
 * @see #138 — idempotency-key surface rollout (tracks per-tool adoption)
 * @see src/server/circuitBreaker.ts — sibling primitive; shape matches
 */

import type { ToolEnvelope } from "../envelope/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Constructor options — all optional; defaults from env or hard-coded fallback. */
export interface IdempotencyStoreOptions {
  /** Milliseconds a cached envelope remains replayable. Default: 600_000 (10 min). */
  ttlMs?: number;
  /** Hard cap on stored entries; LRU eviction once exceeded. Default: 1024. */
  maxEntries?: number;
  /** Injected clock for testing. Defaults to `Date.now`. */
  now?: () => number;
}

interface StoredEntry {
  envelope: ToolEnvelope<unknown>;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// IdempotencyStore
// ---------------------------------------------------------------------------

/**
 * LRU+TTL store keyed by idempotency key. Thread-safety is not a concern:
 * Node is single-threaded, and concurrent `withIdempotencyKey` callers are
 * serialized on the in-flight promise map before they ever touch the store.
 *
 * The underlying `Map` preserves insertion order — re-inserting on access is
 * how we keep LRU semantics cheap (O(1) per op) without a separate list.
 */
export class IdempotencyStore {
  private readonly _ttlMs: number;
  private readonly _maxEntries: number;
  private readonly _now: () => number;
  private readonly _entries = new Map<string, StoredEntry>();

  constructor(options: IdempotencyStoreOptions = {}) {
    this._ttlMs = options.ttlMs ?? 600_000;
    this._maxEntries = options.maxEntries ?? 1024;
    this._now = options.now ?? (() => Date.now());
  }

  /**
   * Fetch a stored envelope for `key`. Returns `undefined` if absent or
   * expired (expired entries are evicted on read).
   */
  get(key: string): ToolEnvelope<unknown> | undefined {
    const entry = this._entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this._now()) {
      this._entries.delete(key);
      return undefined;
    }
    // Touch for LRU: re-insert to move to the end of the iteration order.
    this._entries.delete(key);
    this._entries.set(key, entry);
    return entry.envelope;
  }

  /**
   * Store `envelope` under `key`. Evicts the oldest entries once the map
   * exceeds `maxEntries`. Safe to call with any envelope shape.
   */
  set(key: string, envelope: ToolEnvelope<unknown>): void {
    this._entries.delete(key);
    this._entries.set(key, { envelope, expiresAt: this._now() + this._ttlMs });
    while (this._entries.size > this._maxEntries) {
      const oldestKey = this._entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this._entries.delete(oldestKey);
    }
  }

  /** Number of stored entries. */
  get size(): number {
    return this._entries.size;
  }

  /**
   * Milliseconds a cached envelope remains replayable, as resolved at
   * construction. Exposed so agent-facing surfaces (the capabilities
   * resource) can advertise the store's real retention window instead of
   * a hand-written constant.
   */
  get ttlMs(): number {
    return this._ttlMs;
  }

  /** Drop all entries. Intended for tests and shutdown. */
  clear(): void {
    this._entries.clear();
  }
}

// ---------------------------------------------------------------------------
// withIdempotencyKey — coalescing wrapper
// ---------------------------------------------------------------------------

/** Map of key → in-flight promise, shared per-store to coalesce concurrent callers. */
const inFlightByStore = new WeakMap<
  IdempotencyStore,
  Map<string, Promise<ToolEnvelope<unknown>>>
>();

function inFlightFor(store: IdempotencyStore): Map<string, Promise<ToolEnvelope<unknown>>> {
  let m = inFlightByStore.get(store);
  if (!m) {
    m = new Map();
    inFlightByStore.set(store, m);
  }
  return m;
}

/**
 * Wrap a mutation under an idempotency key.
 *
 * - First call with `key`: runs `fn`, stores the resulting envelope, returns it.
 * - Concurrent callers with the same `key`: all await the same in-flight
 *   promise; replays are marked with `meta.idempotentReplay = true`.
 * - Later call within TTL: returns the stored envelope, marked as replay.
 * - Later call after TTL: `fn` runs again fresh.
 *
 * If `key` is `undefined`, the wrapper is a no-op: `fn` runs directly and
 * nothing is stored. This is the path tools take when the caller omitted
 * `idempotency_key`.
 */
export async function withIdempotencyKey<T>(
  store: IdempotencyStore,
  key: string | undefined,
  fn: () => Promise<ToolEnvelope<T>>,
): Promise<ToolEnvelope<T>> {
  if (key === undefined) return fn();

  const cached = store.get(key);
  if (cached) return markReplay(cached) as ToolEnvelope<T>;

  const inFlight = inFlightFor(store);
  const pending = inFlight.get(key);
  if (pending) {
    const envelope = await pending;
    return markReplay(envelope) as ToolEnvelope<T>;
  }

  const promise = (async () => {
    const envelope = await fn();
    store.set(key, envelope as ToolEnvelope<unknown>);
    return envelope as ToolEnvelope<unknown>;
  })();

  inFlight.set(key, promise);
  try {
    return (await promise) as ToolEnvelope<T>;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Return a shallow clone of `envelope` with `meta.idempotentReplay = true`.
 * Never mutates the stored envelope — replays can be marked safely even when
 * multiple callers share the cached reference.
 */
function markReplay(envelope: ToolEnvelope<unknown>): ToolEnvelope<unknown> {
  return {
    ...envelope,
    meta: { ...envelope.meta, idempotentReplay: true },
  } as ToolEnvelope<unknown>;
}

// ---------------------------------------------------------------------------
// Module singleton — configured from env on first import
// ---------------------------------------------------------------------------

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Module-level store singleton. Tool handlers import this and pass it (plus
 * the caller's `idempotency_key`) to `withIdempotencyKey`.
 *
 * Tuned via:
 *   - `OMNIFOCUS_IDEMPOTENCY_TTL_MS`       (default 600_000)
 *   - `OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES`  (default 1024)
 */
export const idempotencyStore = new IdempotencyStore({
  ttlMs: readPositiveInt("OMNIFOCUS_IDEMPOTENCY_TTL_MS", 600_000),
  maxEntries: readPositiveInt("OMNIFOCUS_IDEMPOTENCY_MAX_ENTRIES", 1024),
});
