/**
 * Build a {@link BenchToolContext} backed by the *real* `JxaTransport`
 * + `OmniJsTransport` chain — what the latency bench measures (#941).
 *
 * Mirrors `composition.composeAdapter` + `composition.composeServices`,
 * but skips `startServer`'s stdio / signal-handler / watcher setup so the
 * harness stays in-process without booting a real MCP server.
 *
 * The workflow definitions live under `tests/benchmark/token-cost/workflows/`
 * and are transport-agnostic; they accept any context shape matching
 * {@link BenchToolContext}. Reusing them directly is the whole point of
 * the AC's "import the workflows" clause.
 *
 * **Side effects:** unlike the token-cost harness (`InMemoryAdapter`,
 * no IO), this context drives real OmniFocus via `osascript`. Workflows
 * create real entities. See `README.md` for the cleanup caveat.
 */

import { JxaTransport } from "../../../src/adapter/jxa/JxaTransport.js";
import type { OmniFocusAdapter } from "../../../src/adapter/OmniFocusAdapter.js";
import { OmniJsTransport } from "../../../src/adapter/omnijs/OmniJsTransport.js";
import { TransportRouter } from "../../../src/adapter/router.js";
import { OmniFocusLruCache } from "../../../src/cache/lruCache.js";
import { parseConfig } from "../../../src/config/env.js";
import type { ResponseMeta } from "../../../src/envelope/index.js";
import { generateCorrelationId, getCorrelationId } from "../../../src/logging/correlation.js";
import { AttachmentService } from "../../../src/services/attachmentService.js";
import { ExportService } from "../../../src/services/exportService.js";
import { FolderService } from "../../../src/services/folderService.js";
import { ForecastService } from "../../../src/services/forecastService.js";
import { PerspectiveService } from "../../../src/services/perspectiveService.js";
import { PluginService } from "../../../src/services/pluginService.js";
import { ProjectService } from "../../../src/services/projectService.js";
import { ReviewService } from "../../../src/services/reviewService.js";
import { SearchService } from "../../../src/services/searchService.js";
import { TagService } from "../../../src/services/tagService.js";
import { TaskService } from "../../../src/services/taskService.js";
import type { BenchToolContext } from "../token-cost/runBench.js";

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: getCorrelationId() ?? generateCorrelationId(),
    durationMs: 0,
    cacheHit: false,
    transport: "jxa",
    ofVersion: "unknown",
    ...partial,
  };
}

/**
 * Build a real adapter (JXA + OmniJS routed via {@link TransportRouter}).
 *
 * Reads `OMNIFOCUS_JXA_TIMEOUT_MS` / `OMNIFOCUS_OMNIJS_TIMEOUT_MS` from
 * env via the canonical {@link parseConfig}, matching production wiring.
 */
function buildRealAdapter(): OmniFocusAdapter {
  const config = parseConfig();
  const jxa = new JxaTransport({ timeoutMs: config.OMNIFOCUS_JXA_TIMEOUT_MS });
  const omnijs = new OmniJsTransport({ timeoutMs: config.OMNIFOCUS_OMNIJS_TIMEOUT_MS });
  return TransportRouter.fromTransports(jxa, omnijs);
}

/**
 * Build a {@link BenchToolContext} ready to drive any token-cost workflow
 * through the real transport chain. Each call returns fresh instances so
 * worker processes never share state.
 */
export function createLatencyBenchContext(): BenchToolContext {
  const adapter = buildRealAdapter();
  const config = parseConfig();
  const cache = new OmniFocusLruCache({
    capacity: config.OMNIFOCUS_CACHE_CAPACITY,
    ttlMs: config.OMNIFOCUS_CACHE_TTL_MS,
  });
  return {
    adapter,
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
    makeMeta,
  };
}
