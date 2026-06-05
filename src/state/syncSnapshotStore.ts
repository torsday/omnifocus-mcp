/**
 * Prior-state snapshot store for the `changes_since` sync tool (#819).
 *
 * Field-level deltas require remembering what an entity looked like *last
 * time* so the current state can be diffed against it — OmniFocus's
 * `modificationDate` tells us *that* an entity changed, not *what* changed.
 * Each `changes_since` response mints an opaque token and stores the full
 * snapshot of entities returned under it; the next call with that token diffs
 * current state against the stored snapshot.
 *
 * Modeled on {@link file://./replayStore.ts}: a bounded, TTL'd, in-memory
 * Map, non-persistent across restarts (a reconnecting client gets a token
 * miss and full re-sync, by design). Snapshots are memory-heavy (a full task
 * + project record set), so the cap is small and enforced *hard* — when full
 * with no expired entries, the oldest snapshot is evicted. This is a
 * session-scoped sync helper, not a general cache.
 *
 * @see src/tools/sync/changesSince.ts — consumer
 * @see docs/adr/0026-sync-delta-protocol.md
 */

import { randomBytes } from "node:crypto";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";

export interface SyncSnapshot {
  /** Full task records at issue time, keyed by id — the diff baseline. */
  tasksById: Map<string, Task>;
  /** Full project records at issue time, keyed by id. */
  projectsById: Map<string, Project>;
  /** ISO timestamp the snapshot was taken — the lower bound for the next delta. */
  issuedAtIso: string;
  /** Absolute Unix-ms timestamp after which this snapshot is expired. */
  expiresAt: number;
}

/** Default snapshot TTL: 10 minutes. */
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Maximum live snapshots before hard eviction (oldest-first). Small — these are heavy. */
export const MAX_SIZE = 8;

/** What a caller provides to {@link SyncSnapshotStore.register} (TTL is added internally). */
export type SyncSnapshotInput = Omit<SyncSnapshot, "expiresAt">;

/**
 * In-memory sync-snapshot store. Module-level singleton for production; tests
 * should instantiate their own for isolation (ReplayStore's pattern).
 */
export class SyncSnapshotStore {
  private readonly _store = new Map<string, SyncSnapshot>();
  private readonly _ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this._ttlMs = ttlMs;
  }

  /** Store a snapshot and return its opaque token. */
  register(snapshot: SyncSnapshotInput): string {
    if (this._store.size >= MAX_SIZE) this._evictExpired();
    // Still at capacity (nothing expired) → evict the oldest by insertion order.
    if (this._store.size >= MAX_SIZE) {
      const oldest = this._store.keys().next().value;
      if (oldest !== undefined) this._store.delete(oldest);
    }
    const token = randomBytes(16).toString("hex");
    this._store.set(token, { ...snapshot, expiresAt: Date.now() + this._ttlMs });
    return token;
  }

  /** Look up a token; returns `undefined` if missing or expired (lazy eviction). */
  get(token: string): SyncSnapshot | undefined {
    const entry = this._store.get(token);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(token);
      return undefined;
    }
    return entry;
  }

  /** Drop a token (e.g. after it is superseded by a fresh snapshot). */
  delete(token: string): void {
    this._store.delete(token);
  }

  /** Live snapshot count (for observability/tests). */
  get size(): number {
    return this._store.size;
  }

  /** Drop everything. Test-isolation helper. */
  clear(): void {
    this._store.clear();
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [k, v] of this._store) {
      if (now > v.expiresAt) this._store.delete(k);
    }
  }
}

/** Module-level singleton — shared across all tool handlers in production. */
export const syncSnapshotStore = new SyncSnapshotStore();
