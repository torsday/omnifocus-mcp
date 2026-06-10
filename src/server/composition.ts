/**
 * Server composition primitives — the seam where individual primitives
 * (transports, router, cache, services, response-meta defaults) are wired
 * into the runtime shape that `startServer` consumes.
 *
 * Splitting this out of `mcpServer.ts` keeps the bootstrap file readable
 * once #289 (49 tool registrations) lands — all 49 registrations call into
 * the factories defined here so they don't re-do the adapter chain plumbing.
 *
 * @see DESIGN.md §17 — lifecycle
 * @see ADR-0002 — JXA + OmniJS dual transport
 * @see ADR-0006 — read-cache strategy
 * @see ADR-0009 — read pool + write queue + OmniJS queue
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { JxaTransport } from "../adapter/jxa/JxaTransport.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { OmniJsTransport } from "../adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../adapter/router.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { Config } from "../config/env.js";
import type { ResponseMeta, Transport } from "../envelope/index.js";
import { generateCorrelationId, getCorrelationId } from "../logging/correlation.js";
import { logger } from "../logging/logger.js";
import { AttachmentService } from "../services/attachmentService.js";
import { ExportService } from "../services/exportService.js";
import { FolderService } from "../services/folderService.js";
import { ForecastService } from "../services/forecastService.js";
import { PerspectiveService } from "../services/perspectiveService.js";
import { PluginService } from "../services/pluginService.js";
import { ProjectService } from "../services/projectService.js";
import { ReviewService } from "../services/reviewService.js";
import { SearchService } from "../services/searchService.js";
import { TagService } from "../services/tagService.js";
import { TaskService } from "../services/taskService.js";
import type { ChangeContext } from "../watcher/types.js";
import type { WebhookOrchestrator } from "../webhooks/orchestrator.js";

// ---------------------------------------------------------------------------
// Adapter chain
// ---------------------------------------------------------------------------

/**
 * Compose the live `OmniFocusAdapter` chain from the validated runtime
 * config.
 *
 * Wires `JxaTransport` and `OmniJsTransport` with their per-transport
 * timeouts (`OMNIFOCUS_JXA_TIMEOUT_MS` / `OMNIFOCUS_OMNIJS_TIMEOUT_MS`) and
 * fronts them with `TransportRouter`, which dispatches each method to the
 * transport chosen by `ROUTING_TABLE` (ADR-0002).
 *
 * Cache wrapping is intentionally out of scope here — `OmniFocusLruCache`
 * (ADR-0006) wraps the returned adapter in a separate composition step so
 * tests can exercise the raw transport chain without the LRU layer.
 */
export function composeAdapter(config: Config): TransportRouter {
  // ADR-0014 — when the E2E harness sets `OMNIFOCUS_E2E_USE_MEMORY=1`,
  // back the router with a single shared `InMemoryAdapter` instead of the
  // live JXA + OmniJS chain. Both routing legs point at the same instance
  // so `ROUTING_TABLE`'s per-method dispatch still applies — every method
  // is satisfied by the in-memory store, and `meta.transport` reflects the
  // routed leg the call traversed. Production callers never set the flag.
  if (config.OMNIFOCUS_E2E_USE_MEMORY) {
    const memory = new InMemoryAdapter();
    return new TransportRouter({ jxa: memory, omnijs: memory });
  }
  const jxa = new JxaTransport({ timeoutMs: config.OMNIFOCUS_JXA_TIMEOUT_MS });
  const omnijs = new OmniJsTransport({ timeoutMs: config.OMNIFOCUS_OMNIJS_TIMEOUT_MS });
  return TransportRouter.fromTransports(jxa, omnijs);
}

// ---------------------------------------------------------------------------
// Service chain
// ---------------------------------------------------------------------------

/**
 * The full service bundle for the runtime: all 11 services plus the shared
 * `OmniFocusLruCache` they read through. Every cache-aware service
 * (`Task`, `Project`, `Tag`, `Folder`) holds the **same** cache instance so
 * cross-service mutations invalidate consistently per ADR-0006.
 *
 * `startServer` constructs this once at boot and threads the same bundle
 * into both `registerOmniFocusResources` (#290) and the per-tool
 * registrations (#289).
 */
export interface ServiceChain {
  cache: OmniFocusLruCache;
  taskService: TaskService;
  projectService: ProjectService;
  tagService: TagService;
  folderService: FolderService;
  attachmentService: AttachmentService;
  exportService: ExportService;
  forecastService: ForecastService;
  perspectiveService: PerspectiveService;
  pluginService: PluginService;
  reviewService: ReviewService;
  searchService: SearchService;
}

/**
 * Build the shared read-cache plus the 11 service singletons the runtime
 * consumes.
 *
 * The cache is sized from `OMNIFOCUS_CACHE_CAPACITY` /
 * `OMNIFOCUS_CACHE_TTL_MS`. `AttachmentService` reads its allowlist and
 * size cap from `OMNIFOCUS_ATTACHMENT_PATHS` /
 * `OMNIFOCUS_MAX_ATTACHMENT_MB` directly — the rest depend only on the
 * adapter and (where caching applies) the shared cache.
 *
 * No state is closed over: each call returns fresh instances, so tests can
 * compose isolated runtimes without globals.
 */
export function composeServices(adapter: OmniFocusAdapter, config: Config): ServiceChain {
  const cache = new OmniFocusLruCache({
    capacity: config.OMNIFOCUS_CACHE_CAPACITY,
    ttlMs: config.OMNIFOCUS_CACHE_TTL_MS,
    // 0 disables the byte-cap (entry-count bound only); any positive value
    // enables size-aware eviction at insert time.
    ...(config.OMNIFOCUS_READ_CACHE_MAX_BYTES > 0
      ? { maxBytes: config.OMNIFOCUS_READ_CACHE_MAX_BYTES }
      : {}),
  });
  return {
    cache,
    taskService: new TaskService({ adapter, cache }),
    projectService: new ProjectService({ adapter, cache }),
    tagService: new TagService({ adapter, cache }),
    folderService: new FolderService({ adapter, cache }),
    attachmentService: new AttachmentService({
      adapter,
      allowedPaths: config.OMNIFOCUS_ATTACHMENT_PATHS,
      maxAttachmentMb: config.OMNIFOCUS_MAX_ATTACHMENT_MB,
    }),
    exportService: new ExportService({ adapter }),
    forecastService: new ForecastService({ adapter, cache }),
    perspectiveService: new PerspectiveService({ adapter }),
    pluginService: new PluginService({ adapter }),
    reviewService: new ReviewService({ adapter, cache }),
    searchService: new SearchService({ adapter }),
  };
}

// ---------------------------------------------------------------------------
// Resource service chain (back-compat shim)
// ---------------------------------------------------------------------------

/**
 * Subset of {@link ServiceChain} that {@link
 * import("../resources/omnifocus.js").registerOmniFocusResources}
 * consumes. Kept as a distinct alias so call sites that only need resource
 * deps don't widen their dependency surface.
 */
export interface ResourceServiceChain {
  cache: OmniFocusLruCache;
  projectService: ProjectService;
  reviewService: ReviewService;
  forecastService: ForecastService;
  perspectiveService: PerspectiveService;
}

/**
 * Back-compat shim — returns the four services
 * `registerOmniFocusResources` consumes plus the shared cache. New callers
 * should prefer {@link composeServices} and pick fields off the wider
 * bundle; kept here so #290's wiring continues to type-check during the
 * #289 transition.
 */
export function composeResourceServices(
  adapter: OmniFocusAdapter,
  config: Config,
): ResourceServiceChain {
  const { cache, projectService, reviewService, forecastService, perspectiveService } =
    composeServices(adapter, config);
  return { cache, projectService, reviewService, forecastService, perspectiveService };
}

// ---------------------------------------------------------------------------
// Response-meta factory
// ---------------------------------------------------------------------------

/** Default values for fields that callers haven't yet measured. */
const DEFAULT_TRANSPORT: Transport = "jxa";
const DEFAULT_OF_VERSION = "unknown";

/**
 * Build a `ResponseMeta` with a fresh correlationId and conservative
 * defaults for fields the caller hasn't measured yet.
 *
 * Tools wrap their handler bodies with timing and transport observation
 * (#283) and pass measured values via `partial`; the defaults here are the
 * shape every tool should fall back to before that wrap lands.
 *
 * `ofVersion` stays `"unknown"` until the lazy OF probe (#36) populates a
 * shared cell that subsequent calls read from.
 */
export function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  // Read from the request-scoped `withCorrelationId` AsyncLocalStorage when
  // available so the envelope's correlationId matches the value emitted on
  // the corresponding `tool.invoked` / `tool.error` log event (#283). Outside
  // a scope (test fixtures, internal callers) we fall back to a fresh ULID.
  return {
    correlationId: getCorrelationId() ?? generateCorrelationId(),
    durationMs: 0,
    cacheHit: false,
    transport: DEFAULT_TRANSPORT,
    ofVersion: DEFAULT_OF_VERSION,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Database-watcher change handler
// ---------------------------------------------------------------------------

/**
 * Build the change handler the database watcher invokes for every
 * OmniFocus write event.
 *
 * The handler runs three steps per change:
 *
 *  1. Ask OmniFocus which specific tasks/projects changed since just before
 *     the watcher's detection timestamp. A 200ms safety buffer guards against
 *     sub-second clock skew between the Swift watcher and the JXA runtime.
 *  2. Targeted cache eviction for those IDs. If the changes-query fails or
 *     returns nothing, fall back to a full cache clear — equivalent to the
 *     coarse pre-#374 behaviour, ensuring correctness when we lose precision.
 *  3. Push per-object resource notifications (`omnifocus://task/{id}`,
 *     `omnifocus://project/{id}`) so subscribers re-read only what changed,
 *     plus aggregate-view notifications (snapshot, inbox, forecast, etc.) so
 *     overview clients stay current regardless of which IDs were touched.
 *
 * Extracted from `startServer` so the handler is independently testable
 * (deps injected directly) and `mcpServer.ts` reads as a flat lifecycle.
 *
 * @param deps  Components the handler closes over for the lifetime of the
 *              server: the adapter (for `getChangesSince`), the shared LRU
 *              cache (for invalidation), the McpServer (for resource
 *              notifications), and the URI list to fan out to.
 * @returns     An async handler suitable for `new DatabaseWatcher(handler)`.
 */
export function makeDatabaseChangeHandler(deps: {
  adapter: OmniFocusAdapter;
  cache: OmniFocusLruCache;
  server: McpServer;
  aggregateUris: readonly string[];
  /**
   * Optional webhook orchestrator (per ADR-0016 §1). When supplied AND at
   * least one webhook is registered, the handler fetches a fresh full
   * snapshot of tasks + projects after the change is detected and feeds
   * it to `orchestrator.observeSnapshot`. The orchestrator diffs against
   * its previous snapshot and dispatches matching events.
   *
   * Failures during the snapshot fetch or the observe call are caught
   * and logged — webhook delivery never blocks or breaks the OF read
   * path (ADR-0016 §4e: "webhooks are signal class, OF reads are record
   * class").
   */
  orchestrator?: WebhookOrchestrator;
}): (ctx: ChangeContext) => Promise<void> {
  const { adapter, cache, server, aggregateUris, orchestrator } = deps;

  // Serializes webhook snapshot capture+apply across overlapping handler
  // runs. The watcher invokes the handler fire-and-forget per debounce
  // window, so runs overlap whenever the JXA reads outlast the debounce
  // gap. Without the chain, a slower (older) snapshot fetch can complete
  // after a faster (newer) one and overwrite the orchestrator's diff
  // baseline with stale state — re-delivering already-dispatched events
  // on the next observation. Chaining fetch+observe applies snapshots in
  // fetch order, so the baseline only ever moves forward.
  let observeChain: Promise<void> = Promise.resolve();

  return async (ctx: ChangeContext): Promise<void> => {
    // Safety buffer: subtract 200 ms from detectedAt to guard against
    // sub-second clock skew between the Swift watcher and the JXA runtime.
    const sinceMs = new Date(ctx.detectedAt).getTime() - 200;
    const sinceIso = new Date(sinceMs).toISOString();

    let changed: { taskIds: string[]; projectIds: string[] } = { taskIds: [], projectIds: [] };
    let querySucceeded = false;

    try {
      changed = await adapter.getChangesSince(sinceIso);
      querySucceeded = true;
    } catch (err) {
      // OF may not be running, or the JXA bridge may be warming up.
      // Fall back to blanket cache clear.
      logger.debug({ event: "database.changed.query_failed", err });
    }

    const targeted =
      querySucceeded && (changed.taskIds.length > 0 || changed.projectIds.length > 0);

    if (targeted) {
      // Targeted: evict only the affected entries.
      for (const id of changed.taskIds) {
        cache.invalidate(`task:${id}`);
      }
      for (const id of changed.projectIds) {
        cache.invalidate(`project:${id}`);
      }
      // List-shaped results (task/project lists, forecast, perspective
      // evaluations, tag/folder lists with embedded counts) embed the rows
      // that just changed and cannot be surgically pruned — same invariant
      // as the mutation-side helpers in src/cache/invalidation.ts.
      cache.invalidate("forecast:*");
      cache.invalidate("perspective:*");
      cache.invalidate("search:*");
      cache.invalidate("tag:list");
      cache.invalidate("folder:list");
    } else {
      // Unknown what changed (query failed, or nothing found with new timestamp).
      // Clear everything conservatively.
      cache.clear();
    }

    // Webhook observation (ADR-0016 §1). Skip when no orchestrator is
    // wired or no webhooks are registered — the snapshot fetch is real
    // work (two adapter calls) and there's no point paying for it when
    // there is no consumer. The fetch deliberately bypasses the cache
    // we just invalidated so the orchestrator sees ground-truth state.
    if (orchestrator?.shouldObserve()) {
      const observation = observeChain.then(async () => {
        const [tasks, projects] = await Promise.all([
          adapter.listTasks({}),
          adapter.listProjects(),
        ]);
        await orchestrator.observeSnapshot(tasks, projects);
      });
      // Keep the chain alive on failure — each run logs its own error.
      observeChain = observation.catch(() => {});
      try {
        await observation;
      } catch (err) {
        // ADR-0016 §4e: webhook failures must never propagate into the
        // OF read path. Cache invalidation and resource notifications
        // below still fire normally.
        logger.debug({ event: "database.changed.webhook_observe_failed", err });
      }
    }

    // Per-object resource notifications (agents subscribed to specific tasks/projects)
    for (const id of changed.taskIds) {
      server.server.sendResourceUpdated({ uri: `omnifocus://task/${id}` }).catch(() => {});
    }
    for (const id of changed.projectIds) {
      server.server.sendResourceUpdated({ uri: `omnifocus://project/${id}` }).catch(() => {});
    }

    // Aggregate-view notifications — always fire so snapshot/inbox/forecast
    // clients see the update regardless of what specifically changed.
    for (const uri of aggregateUris) {
      server.server.sendResourceUpdated({ uri }).catch(() => {});
    }

    logger.debug({
      event: "database.changed",
      source: ctx.source,
      detectedAt: ctx.detectedAt,
      changedTasks: changed.taskIds.length,
      changedProjects: changed.projectIds.length,
      cacheStrategy: targeted ? "targeted" : "full-clear",
    });
  };
}
