/**
 * Replay-token store for `clarification-needed` responses.
 *
 * When a tool cannot resolve ambiguity deterministically, it registers a
 * callback here and returns a `clarification-needed` envelope carrying the
 * opaque token. The agent presents the question to the user, then calls the
 * `clarify` tool with `{ replayToken, choice }`. The dispatcher looks up the
 * token, validates the choice, and runs the stored callback.
 *
 * Design decisions:
 * - Tokens are random hex strings (no semantic content — opaque by design).
 * - Storage is a plain Map (no third-party LRU dependency) with O(n) eviction
 *   on insert — fine for the expected low cardinality (< 100 live tokens at
 *   any moment per session).
 * - Tokens expire after `TTL_MS` (default 5 minutes). Expired entries are
 *   lazily evicted on lookup and eagerly evicted on insert once the store
 *   exceeds `MAX_SIZE`.
 * - Rate-limiting: each IP/session is not modelled here; the `clarify` tool
 *   delegates abuse prevention to the existing ToolRateLimiter.
 * - Survives within a server session; intentionally NOT persistent across
 *   restarts — agents must not rely on token survival across reconnects.
 *
 * @see src/tools/clarify.ts — consumer
 * @see src/envelope/index.ts — ClarificationNeeded shape
 */

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayCallback = (choice: number) => Promise<unknown>;

export interface ReplayEntry {
  /** Human-readable labels for each choice — used by the `clarify` validator. */
  options: string[];
  /** Executes the chosen interpretation; returns a ToolEnvelope. */
  callback: ReplayCallback;
  /** Absolute Unix-ms timestamp after which this entry is considered expired. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default token TTL: 5 minutes. */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Maximum number of live tokens before eager eviction kicks in. */
export const MAX_SIZE = 200;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * In-memory replay-token store. Module-level singleton for production; tests
 * should instantiate their own `ReplayStore` for isolation.
 */
export class ReplayStore {
  private readonly _store = new Map<string, ReplayEntry>();
  private readonly _ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this._ttlMs = ttlMs;
  }

  /**
   * Register an ambiguity resolution callback and return an opaque token.
   *
   * @param options - Human-readable label for each valid choice (rendered
   *   verbatim in the `clarification-needed` envelope's `options` array).
   * @param callback - Async function called with the chosen index (0-based)
   *   when the agent calls `clarify`. Must return a `ToolEnvelope`.
   * @returns Opaque hex token to embed in the `clarification-needed` envelope.
   */
  register(options: string[], callback: ReplayCallback): string {
    // Eager eviction: if we're at capacity, remove all expired entries first.
    if (this._store.size >= MAX_SIZE) {
      this._evictExpired();
    }

    const token = randomBytes(16).toString("hex");
    this._store.set(token, {
      options,
      callback,
      expiresAt: Date.now() + this._ttlMs,
    });
    return token;
  }

  /**
   * Look up a token and return the entry, or `undefined` if missing / expired.
   * Expired entries are removed on lookup (lazy eviction).
   */
  get(token: string): ReplayEntry | undefined {
    const entry = this._store.get(token);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(token);
      return undefined;
    }
    return entry;
  }

  /**
   * Consume a token (look up + delete in one step). Returns `undefined` if the
   * token is missing or expired. Consuming prevents double-replay.
   */
  consume(token: string): ReplayEntry | undefined {
    const entry = this.get(token);
    if (entry) this._store.delete(token);
    return entry;
  }

  /** Current live-token count (for observability). */
  get size(): number {
    return this._store.size;
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this._store) {
      if (now > v.expiresAt) this._store.delete(k);
    }
  }
}

/** Module-level singleton — shared across all tool handlers in production. */
export const replayStore = new ReplayStore();
