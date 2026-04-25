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

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { JxaTransport } from "../adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../adapter/router.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { Config } from "../config/env.js";
import type { ResponseMeta, Transport } from "../envelope/index.js";
import { generateCorrelationId, getCorrelationId } from "../logging/correlation.js";
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
    forecastService: new ForecastService({ adapter }),
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
