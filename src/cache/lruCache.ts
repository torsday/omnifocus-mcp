/**
 * LRU read cache for omnifocus-mcp.
 *
 * Wraps `lru-cache` with a typed `wrap(key, factory)` / `invalidate(scope)`
 * API. The cache sits between service and adapter — services read through it;
 * every mutation calls `invalidate` with the appropriate scope.
 *
 * TTL and capacity come from the parsed config (OMNIFOCUS_CACHE_TTL_MS,
 * OMNIFOCUS_CACHE_CAPACITY). Stats are surfaced for the `internal_status`
 * tool. A `cache.invalidated` event is emitted after each invalidation so the
 * observability layer can log it per DESIGN §21.
 *
 * @see DESIGN.md §6.5 — caching strategy
 * @see docs/adr/0006-read-cache-strategy.md
 */

import { EventEmitter } from "node:events";
import { LRUCache } from "lru-cache";

// ---------------------------------------------------------------------------
// Invalidation scope types
// ---------------------------------------------------------------------------

/**
 * Typed invalidation scope. Conservative: scopes cover all keys that could be
 * stale after a mutation to the named resource.
 */
export type InvalidationScope =
  | `task:${string}`
  | `project:${string}`
  | "forecast:*"
  | "perspective:*"
  | "search:*"
  | `tag:${string}`
  | `folder:${string}`;

// ---------------------------------------------------------------------------
// Cache stats
// ---------------------------------------------------------------------------

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  /**
   * Number of `wrap()` calls that joined an already-in-flight factory for
   * the same key instead of issuing a new adapter call. See DESIGN §16 —
   * thundering-herd coalescing.
   */
  coalesced: number;
}

// ---------------------------------------------------------------------------
// Cache options
// ---------------------------------------------------------------------------

export interface LruCacheOptions {
  /** Maximum number of entries. Default: 256. */
  capacity?: number;
  /** Entry TTL in milliseconds. Default: 30000. */
  ttlMs?: number;
}

// ---------------------------------------------------------------------------
// LruCache class
// ---------------------------------------------------------------------------

/**
 * LRU cache with typed invalidation scopes and an event emitter.
 *
 * Keys are arbitrary strings; values are `unknown` at the storage layer and
 * typed by callers via generics on `wrap`.
 */
export class OmniFocusLruCache extends EventEmitter {
  // lru-cache requires value extends {}; wrap in a box so we can store any value.
  private readonly cache: LRUCache<string, { v: unknown }>;
  /**
   * Promises for in-flight `wrap()` factory invocations, keyed by cache key.
   * A second `wrap()` call for the same key while a prior factory is still
   * pending joins the same promise instead of issuing a duplicate adapter
   * call (DESIGN §16 — thundering-herd coalescing).
   *
   * Each entry carries a token. If `invalidate()` removes the entry before
   * the factory resolves, the factory's result is discarded (not cached)
   * and any already-awaiting callers still receive that original result —
   * the only guarantee we can offer without cancellation.
   */
  private readonly inflight = new Map<string, { token: symbol; promise: Promise<unknown> }>();
  private hits = 0;
  private misses = 0;
  private coalesced = 0;
  private evictions = 0;

  constructor({ capacity = 256, ttlMs = 30_000 }: LruCacheOptions = {}) {
    super();
    this.cache = new LRUCache<string, { v: unknown }>({
      max: capacity,
      ttl: ttlMs,
      // Count evictions for stats surface
      disposeAfter: () => {
        this.evictions++;
      },
    });
  }

  /**
   * Return the cached value for `key`, or call `factory` to produce it and
   * store the result before returning.
   *
   * Coalesces concurrent misses: if a factory for `key` is already in flight,
   * subsequent `wrap()` calls await that same promise rather than issuing a
   * duplicate factory invocation. Counted in `stats().coalesced`.
   *
   * Factory rejections are never cached; each side of a coalesced group sees
   * the same rejection, and the next call after rejection kicks off a fresh
   * factory.
   */
  async wrap<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.hits++;
      return cached.v as T;
    }
    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      this.coalesced++;
      return (await existing.promise) as T;
    }
    this.misses++;

    const token = Symbol(key);
    const promise = (async () => {
      try {
        const value = await factory();
        // Only cache if our token is still the current inflight head — an
        // invalidate() during flight clears the inflight entry so the stale
        // result is not committed to the cache.
        if (this.inflight.get(key)?.token === token) {
          this.cache.set(key, { v: value });
        }
        return value;
      } finally {
        if (this.inflight.get(key)?.token === token) {
          this.inflight.delete(key);
        }
      }
    })();
    this.inflight.set(key, { token, promise });
    return (await promise) as T;
  }

  /**
   * Invalidate all keys matching `scope`.
   *
   * Scope matching rules:
   * - `task:${id}` — removes all keys that start with the scope prefix
   * - `forecast:*` / `perspective:*` / `search:*` — removes all keys with that prefix
   * - Same logic applies to `project:`, `tag:`, `folder:` scopes
   *
   * Emits `"cache.invalidated"` with `{ scope, keysRemoved }` after removal.
   */
  invalidate(scope: InvalidationScope): void {
    const prefix = scope.endsWith(":*") ? scope.slice(0, -1) : `${scope}:`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) || key === scope) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    // Also evict any in-flight factories whose key falls under this scope.
    // The factory result is discarded when it resolves (see wrap()'s token
    // guard), so the cache cannot end up with a stale post-invalidate value.
    for (const key of this.inflight.keys()) {
      if (key.startsWith(prefix) || key === scope) {
        this.inflight.delete(key);
      }
    }

    this.emit("cache.invalidated", { scope, keysRemoved: keysToDelete.length });
  }

  /** Return a snapshot of cache stats for `internal_status`. */
  stats(): CacheStats {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      coalesced: this.coalesced,
    };
  }

  /** Directly set a value (for testing / seeding). */
  set(key: string, value: unknown): void {
    this.cache.set(key, { v: value });
  }

  /** Check whether a key is present (without affecting hit/miss counters). */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /** Remove all entries. */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
