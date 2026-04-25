/**
 * `wrapWithConcurrency` — thread-disciplined `OmniFocusAdapter` wrapper.
 *
 * Per ADR-0009 / DESIGN §16, every adapter call is gated by exactly one of
 * three concurrency primitives:
 *
 * - **ReadPool** — bounded-concurrency semaphore for non-mutating JXA calls.
 *   Default 2 slots (`OMNIFOCUS_READ_POOL_SIZE`). Multiple concurrent reads
 *   may run; the pool prevents `osascript` stampedes.
 * - **JXA WriteQueue** — serial single-slot for mutating JXA calls. The JXA
 *   runtime is single-threaded relative to OmniFocus's main thread; a
 *   second concurrent write produces undefined ordering.
 * - **OmniJS Queue** — serial single-slot for *every* OmniJS call (read or
 *   write). The `evaluateJavascript` URL-scheme callback contends on the
 *   filesystem regardless of whether the script is reading or writing OF
 *   data, so the conservative move is to serialize all OmniJS traffic.
 *
 * Dispatch decision per call:
 *
 *   if (ROUTING_TABLE[method] === "omnijs")    → omniJsQueue
 *   else if (MUTATING_METHODS.has(method))      → jxaWriteQueue
 *   else                                        → readPool
 *
 * Implementation note: a `Proxy` is used rather than an explicit class with
 * one delegate per method. The `OmniFocusAdapter` surface is wide (~50
 * methods) and the dispatch logic is uniform; Proxy keeps the wrapping
 * code single-screen and guarantees that any future method added to the
 * interface (and to `ROUTING_TABLE`) is automatically routed without an
 * accompanying change here. If a method is on the underlying adapter but
 * absent from `ROUTING_TABLE`, the proxy falls back to a direct call —
 * the adapter contract still holds.
 *
 * @see DESIGN.md §16 — concurrency model
 * @see docs/adr/0009-concurrency-pool-and-queue.md
 */

import type { ReadPool } from "../concurrency/ReadPool.js";
import type { WriteQueue } from "../concurrency/WriteQueue.js";
import type { OmniFocusAdapter } from "./OmniFocusAdapter.js";
import { type AdapterMethod, ROUTING_TABLE } from "./router.js";

// ---------------------------------------------------------------------------
// Mutating-method classification
// ---------------------------------------------------------------------------

/**
 * Adapter methods that mutate OmniFocus state. Membership decides whether
 * a JXA-routed call goes through `readPool` (fast, concurrent) or
 * `jxaWriteQueue` (serial, capped). OmniJS-routed methods bypass this set
 * entirely — they all funnel through `omniJsQueue` regardless.
 *
 * Kept as a `Set<AdapterMethod>` (not a string array) so a typo surfaces
 * at compile time rather than silently routing a write through the read
 * pool.
 */
export const MUTATING_METHODS: ReadonlySet<AdapterMethod> = new Set<AdapterMethod>([
  // Tasks
  "createTask",
  "updateTask",
  "completeTask",
  "uncompleteTask",
  "dropTask",
  "undropTask",
  "deleteTask",
  "moveTask",
  "reorderTask",
  "duplicateTask",
  "batchCreateTasks",
  "batchUpdateTasks",
  "batchCompleteTasks",
  // Projects
  "createProject",
  "updateProject",
  "completeProject",
  "dropProject",
  "moveProject",
  "deleteProject",
  "markProjectReviewed",
  "setProjectReviewInterval",
  // Tags
  "createTag",
  "updateTag",
  "deleteTag",
  // Folders
  "createFolder",
  "updateFolder",
  "deleteFolder",
  // Sync — kicks the sync engine, side-effecting
  "syncTrigger",
  // Attachments
  "addAttachment",
  "removeAttachment",
  // App lifecycle
  "appLaunch",
  // Plug-in / OmniJS-only mutations (still routed through omniJsQueue, but
  // listed here for completeness when the routing table changes)
  "pluginInvoke",
  // Raw escape hatches — conservative: serialize, since callers can do
  // anything inside them.
  "runJxaScript",
  "runOmniJsScript",
]);

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export interface ConcurrencyDeps {
  readPool: ReadPool;
  jxaWriteQueue: WriteQueue;
  omniJsQueue: WriteQueue;
}

/**
 * Pick the concurrency primitive that should gate a given adapter method.
 * Exported for unit tests; production code calls {@link wrapWithConcurrency}.
 */
export function pickGate(method: AdapterMethod, deps: ConcurrencyDeps): ReadPool | WriteQueue {
  if (ROUTING_TABLE[method] === "omnijs") return deps.omniJsQueue;
  if (MUTATING_METHODS.has(method)) return deps.jxaWriteQueue;
  return deps.readPool;
}

/**
 * Wrap an `OmniFocusAdapter` so every method call is gated by the
 * appropriate concurrency primitive (ReadPool / JXA WriteQueue / OmniJS
 * Queue). The returned object satisfies `OmniFocusAdapter` exactly — the
 * wrapper is invisible to callers.
 *
 * Properties that are not in `ROUTING_TABLE` (notably accessors that the
 * concrete adapter exposes for diagnostics, like `routingTable` on
 * `TransportRouter`) pass through untouched.
 */
export function wrapWithConcurrency(
  inner: OmniFocusAdapter,
  deps: ConcurrencyDeps,
): OmniFocusAdapter {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || !(prop in ROUTING_TABLE)) {
        return Reflect.get(target, prop, receiver);
      }
      const method = prop as AdapterMethod;
      const gate = pickGate(method, deps);
      // Bind once so the inner adapter sees its own `this`.
      const original = Reflect.get(target, method, receiver) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const bound = original.bind(target);
      return (...args: unknown[]): Promise<unknown> => gate.run(() => bound(...args));
    },
  }) as OmniFocusAdapter;
}
