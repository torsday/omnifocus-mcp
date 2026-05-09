/**
 * Token-cost benchmark harness (#771).
 *
 * Drives canonical LLM workflows against the {@link InMemoryAdapter} and
 * measures the I/O an MCP client would observe per call:
 *
 * - `requestBytes`: UTF-8 length of the JSON-stringified tool input
 * - `responseBytes`: UTF-8 length of the JSON-stringified tool response
 *   (matches what `toolResponse(...)` emits, including both `content[0].text`
 *   and `structuredContent`)
 * - `tokens`: byte estimate via {@link estimateTokens}
 *
 * Why measure at the handler boundary rather than the JSON-RPC wire? The
 * server boots a real `McpServer` only inside `startServer()` (signal
 * handlers, stdio, watcher), so reusing it for an in-process benchmark
 * would mean refactoring boot — explicit non-goal of #771. The handler
 * boundary captures everything that varies under optimization in #770:
 * tool descriptions (via tools/list), input schemas, response payloads.
 * The JSON-RPC framing adds a small constant overhead per call (~30 B for
 * `{"jsonrpc":"2.0","id":N,"result":...}`); measuring without it isolates
 * the optimizable surface.
 *
 * @see tests/benchmark/token-cost/README.md — baseline policy, fixtures
 * @see #770 — parent epic (per-tool optimizations consume this baseline)
 */

import { InMemoryAdapter } from "../../../src/adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../../src/cache/lruCache.js";
import type { ResponseMeta } from "../../../src/envelope/index.js";
import { isError, type ToolEnvelope, toolResponse } from "../../../src/envelope/index.js";
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
import { jsonByteLength } from "./byteCounter.js";
import { estimateTokens } from "./tokenizer.js";
import { computeToolsListBytes } from "./toolsList.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallRecord {
  tool: string;
  requestBytes: number;
  responseBytes: number;
  outcome: "ok" | "error";
}

export interface WorkflowResult {
  workflow: string;
  toolListBytes: number;
  callCount: number;
  totalRequestBytes: number;
  totalResponseBytes: number;
  totalRoundTripBytes: number;
  totalTokens: number;
  /** Per-tool aggregate response bytes — surfaces hotspots. */
  byTool: Record<string, { calls: number; responseBytes: number }>;
}

/**
 * Service+cache+adapter bundle the workflow handlers consume. Tools accept a
 * superset of these fields via per-tool context shapes (e.g. `{adapter,
 * makeMeta, cache}` or `{taskService, makeMeta}`); workflows wire the
 * specific shape each call needs.
 */
export interface BenchToolContext {
  adapter: InMemoryAdapter;
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
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

/**
 * Local mirror of `composition.ts` `makeMeta` — duplicated rather than
 * imported because that module pulls in `JxaTransport`, which static-
 * imports precompiled JXA `.js` scripts that `tsx` cannot resolve as ESM.
 * Keeping this small inline copy avoids dragging the live transport chain
 * into the bench harness.
 */
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

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------

/**
 * Build a fresh `BenchToolContext` backed by an `InMemoryAdapter`. Each
 * workflow gets its own context so cross-workflow state never leaks.
 */
/** Pin the adapter clock to a fixed date so timestamps in responses are stable. */
const PINNED_NOW = () => new Date("2026-05-01T12:00:00.000Z");

export function createBenchContext(): BenchToolContext {
  const adapter = new InMemoryAdapter({ now: PINNED_NOW });
  const cache = new OmniFocusLruCache({ capacity: 256, ttlMs: 60_000 });
  return {
    adapter,
    cache,
    taskService: new TaskService({ adapter, cache }),
    projectService: new ProjectService({ adapter, cache }),
    tagService: new TagService({ adapter, cache }),
    folderService: new FolderService({ adapter, cache }),
    attachmentService: new AttachmentService({
      adapter,
      allowedPaths: [],
      maxAttachmentMb: 16,
    }),
    exportService: new ExportService({ adapter }),
    forecastService: new ForecastService({ adapter }),
    perspectiveService: new PerspectiveService({ adapter }),
    pluginService: new PluginService({ adapter }),
    reviewService: new ReviewService({ adapter, cache }),
    searchService: new SearchService({ adapter }),
    makeMeta,
  };
}

export class Bench {
  readonly workflow: string;
  private readonly calls: CallRecord[] = [];

  constructor(workflow: string) {
    this.workflow = workflow;
  }

  /**
   * Invoke a tool handler, record per-call I/O, and return the envelope so
   * the workflow can chain on it.
   *
   * `fn` receives the raw input the workflow already passed and returns the
   * envelope the handler produced. The harness wraps with `toolResponse(...)`
   * to match the wire shape an MCP client would observe.
   */
  async call<T>(
    tool: string,
    input: unknown,
    fn: () => Promise<ToolEnvelope<T>>,
  ): Promise<ToolEnvelope<T>> {
    const requestBytes = jsonByteLength(input);
    let envelope: ToolEnvelope<T>;
    let outcome: "ok" | "error" = "ok";
    try {
      envelope = await fn();
    } catch (err) {
      this.calls.push({ tool, requestBytes, responseBytes: 0, outcome: "error" });
      throw err;
    }
    if (isError(envelope)) outcome = "error";
    const responseBytes = jsonByteLength(toolResponse(envelope));
    this.calls.push({ tool, requestBytes, responseBytes, outcome });
    return envelope;
  }

  /** Aggregate results into a `WorkflowResult`. */
  result(toolListBytes: number): WorkflowResult {
    let totalRequest = 0;
    let totalResponse = 0;
    const byTool: Record<string, { calls: number; responseBytes: number }> = {};
    for (const c of this.calls) {
      totalRequest += c.requestBytes;
      totalResponse += c.responseBytes;
      let slot = byTool[c.tool];
      if (slot === undefined) {
        slot = { calls: 0, responseBytes: 0 };
        byTool[c.tool] = slot;
      }
      slot.calls += 1;
      slot.responseBytes += c.responseBytes;
    }
    const totalRoundTrip = totalRequest + totalResponse;
    return {
      workflow: this.workflow,
      toolListBytes,
      callCount: this.calls.length,
      totalRequestBytes: totalRequest,
      totalResponseBytes: totalResponse,
      totalRoundTripBytes: totalRoundTrip,
      totalTokens: estimateTokens(toolListBytes + totalRoundTrip),
      byTool,
    };
  }
}

/** Convenience — share one tools/list measurement across workflows in a run. */
export function measureToolsListOnce(): number {
  return computeToolsListBytes();
}
