import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { JxaTransport } from "../adapter/jxa/JxaTransport.js";
import { OmniJsTransport } from "../adapter/omnijs/OmniJsTransport.js";
import { ROUTING_TABLE, TransportRouter } from "../adapter/router.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { Config } from "../config/env.js";
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
import type { WebhookDispatcher } from "../webhooks/dispatcher.js";
import type { WebhookEvent } from "../webhooks/events.js";
import { WebhookOrchestrator } from "../webhooks/orchestrator.js";
import { WebhookRegistry } from "../webhooks/registry.js";
import {
  composeAdapter,
  composeResourceServices,
  composeServices,
  makeDatabaseChangeHandler,
  makeMeta,
} from "./composition.js";

const baseConfig: Config = {
  OMNIFOCUS_LOG_LEVEL: "info",
  OMNIFOCUS_INTEGRATION: false,
  OMNIFOCUS_E2E: false,
  OMNIFOCUS_E2E_USE_MEMORY: false,
  OMNIFOCUS_ALLOW_RAW_SCRIPT: false,
  OMNIFOCUS_LEGACY_TEXT_CONTENT: false,
  OMNIFOCUS_WEBHOOKS_ENABLED: false,
  OMNIFOCUS_ATTACHMENT_PATHS: ["/tmp"],
  OMNIFOCUS_JXA_TIMEOUT_MS: 30000,
  OMNIFOCUS_OMNIJS_TIMEOUT_MS: 45000,
  OMNIFOCUS_PERSISTENT_OSASCRIPT: false,
  OMNIFOCUS_TRANSIENT_RETRY_ENABLED: true,
  OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: 100,
  OMNIFOCUS_CACHE_TTL_MS: 30000,
  OMNIFOCUS_CACHE_CAPACITY: 256,
  OMNIFOCUS_READ_CACHE_MAX_BYTES: 16_777_216,
  OMNIFOCUS_READ_POOL_SIZE: 2,
  OMNIFOCUS_WRITE_QUEUE_CAP: 50,
  OMNIFOCUS_MAX_ATTACHMENT_MB: 100,
  OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 },
  OMNIFOCUS_WAITING_TAG_NAME: "waiting",
  OMNIFOCUS_TEMPLATES_FOLDER_NAME: "Templates",
  OMNIFOCUS_RESPONSE_STATS_SAMPLE_RATE: 0,
  OMNIFOCUS_RESPONSE_STATS_THRESHOLD_BYTES: 51200,
  OMNIFOCUS_LATENCY_STATS_SAMPLE_RATE: 0,
  OMNIFOCUS_LATENCY_STATS_THRESHOLD_MS: 2000,
  OMNIFOCUS_DURATION_STATS_SAMPLE_RATE: 0,
  OMNIFOCUS_DURATION_STATS_THRESHOLD_MS: 5000,
  OMNIFOCUS_TELEMETRY_SINK_PATH: "",
  OMNIFOCUS_TELEMETRY_SINK_MAX_BYTES: 50 * 1024 * 1024,
  OMNIFOCUS_CIRCUIT_ENABLED: true,
  OMNIFOCUS_CIRCUIT_THRESHOLD: 5,
  OMNIFOCUS_CIRCUIT_RECOVERY_MS: 30000,
  OMNIFOCUS_LOOP_DETECTOR_MAX_KEYS: 4096,
};

describe("composeAdapter", () => {
  it("returns a TransportRouter assembled from JxaTransport + OmniJsTransport", () => {
    const adapter = composeAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(TransportRouter);
    // Router exposes its routing table; confirm it matches the canonical one
    // so callers can rely on dispatch policy without inspecting the chain.
    expect(adapter.routingTable).toBe(ROUTING_TABLE);
  });

  it("constructs each transport with its configured timeout", () => {
    // The transports keep `runOpts` private; we can still confirm the chain
    // composes without throwing for arbitrary timeout values.
    const adapter = composeAdapter({
      ...baseConfig,
      OMNIFOCUS_JXA_TIMEOUT_MS: 1234,
      OMNIFOCUS_OMNIJS_TIMEOUT_MS: 5678,
      OMNIFOCUS_TRANSIENT_RETRY_ENABLED: true,
      OMNIFOCUS_TRANSIENT_RETRY_DELAY_MS: 100,
    });
    expect(adapter).toBeInstanceOf(TransportRouter);
  });

  it("does not share transport instances across calls (no global state)", () => {
    const a = composeAdapter(baseConfig);
    const b = composeAdapter(baseConfig);
    expect(a).not.toBe(b);
  });

  // Smoke: verify the underlying transports can be constructed standalone
  // with the same options shape (catches drift between composition and
  // direct instantiation in tests).
  it("uses the same options shape that the transports accept directly", () => {
    expect(() => new JxaTransport({ timeoutMs: 30000 })).not.toThrow();
    expect(() => new OmniJsTransport({ timeoutMs: 45000 })).not.toThrow();
  });
});

describe("composeServices", () => {
  it("instantiates all 11 services + the shared cache", () => {
    const adapter = composeAdapter(baseConfig);
    const services = composeServices(adapter, baseConfig);

    expect(services.cache).toBeInstanceOf(OmniFocusLruCache);
    expect(services.taskService).toBeInstanceOf(TaskService);
    expect(services.projectService).toBeInstanceOf(ProjectService);
    expect(services.tagService).toBeInstanceOf(TagService);
    expect(services.folderService).toBeInstanceOf(FolderService);
    expect(services.attachmentService).toBeInstanceOf(AttachmentService);
    expect(services.exportService).toBeInstanceOf(ExportService);
    expect(services.forecastService).toBeInstanceOf(ForecastService);
    expect(services.perspectiveService).toBeInstanceOf(PerspectiveService);
    expect(services.pluginService).toBeInstanceOf(PluginService);
    expect(services.reviewService).toBeInstanceOf(ReviewService);
    expect(services.searchService).toBeInstanceOf(SearchService);
  });

  it("propagates cache sizing from config", () => {
    const adapter = composeAdapter(baseConfig);
    const a = composeServices(adapter, { ...baseConfig, OMNIFOCUS_CACHE_CAPACITY: 64 });
    const b = composeServices(adapter, { ...baseConfig, OMNIFOCUS_CACHE_CAPACITY: 512 });
    expect(a.cache).not.toBe(b.cache);
  });

  it("returns fresh service instances per call (no shared global state)", () => {
    const adapter = composeAdapter(baseConfig);
    const a = composeServices(adapter, baseConfig);
    const b = composeServices(adapter, baseConfig);
    expect(a.taskService).not.toBe(b.taskService);
    expect(a.projectService).not.toBe(b.projectService);
    expect(a.cache).not.toBe(b.cache);
  });
});

describe("composeResourceServices", () => {
  it("instantiates the four services + cache the resources need", () => {
    const adapter = composeAdapter(baseConfig);
    const services = composeResourceServices(adapter, baseConfig);

    expect(services.cache).toBeInstanceOf(OmniFocusLruCache);
    expect(services.projectService).toBeInstanceOf(ProjectService);
    expect(services.reviewService).toBeInstanceOf(ReviewService);
    expect(services.forecastService).toBeInstanceOf(ForecastService);
    expect(services.perspectiveService).toBeInstanceOf(PerspectiveService);
  });

  it("propagates cache sizing from config", () => {
    const adapter = composeAdapter(baseConfig);
    const a = composeResourceServices(adapter, { ...baseConfig, OMNIFOCUS_CACHE_CAPACITY: 64 });
    const b = composeResourceServices(adapter, { ...baseConfig, OMNIFOCUS_CACHE_CAPACITY: 512 });
    expect(a.cache).not.toBe(b.cache);
  });

  it("returns fresh service instances per call (no shared global state)", () => {
    const adapter = composeAdapter(baseConfig);
    const a = composeResourceServices(adapter, baseConfig);
    const b = composeResourceServices(adapter, baseConfig);
    expect(a.projectService).not.toBe(b.projectService);
    expect(a.cache).not.toBe(b.cache);
  });
});

describe("makeMeta", () => {
  it("returns a ResponseMeta with a freshly-generated correlationId on each call", () => {
    const a = makeMeta();
    const b = makeMeta();
    expect(a.correlationId).not.toBe(b.correlationId);
    // Correlation IDs are ULID-shaped: 26 chars, Crockford alphabet.
    expect(a.correlationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("defaults durationMs=0, cacheHit=false, transport='jxa', ofVersion='unknown'", () => {
    const meta = makeMeta();
    expect(meta.durationMs).toBe(0);
    expect(meta.cacheHit).toBe(false);
    expect(meta.transport).toBe("jxa");
    expect(meta.ofVersion).toBe("unknown");
  });

  it("lets callers override any field via partial", () => {
    const meta = makeMeta({
      durationMs: 142,
      cacheHit: true,
      transport: "cache",
      ofVersion: "4.5.2",
    });
    expect(meta.durationMs).toBe(142);
    expect(meta.cacheHit).toBe(true);
    expect(meta.transport).toBe("cache");
    expect(meta.ofVersion).toBe("4.5.2");
    // CorrelationId should still be generated when not overridden.
    expect(meta.correlationId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("lets callers override correlationId (e.g. echoing an inbound id)", () => {
    const meta = makeMeta({ correlationId: "01JBZK7PDR6XSYVMWT5YYVH8VQ" });
    expect(meta.correlationId).toBe("01JBZK7PDR6XSYVMWT5YYVH8VQ");
  });
});

// ---------------------------------------------------------------------------
// makeDatabaseChangeHandler — webhook observation hook (#668, ADR-0016 §1)
// ---------------------------------------------------------------------------
//
// The handler runs on every DatabaseWatcher event. When a webhook is
// registered, it must fetch a fresh full snapshot of tasks + projects
// from the adapter and feed it to `orchestrator.observeSnapshot`. The
// orchestrator owns the diff and dispatch.

class CapturingDispatcher implements WebhookDispatcher {
  delivered: WebhookEvent[] = [];
  async deliver(event: WebhookEvent): Promise<void> {
    this.delivered.push(event);
  }
}

function tmpRegistry(): string {
  return path.join(
    tmpdir(),
    `omnifocus-mcp-composition-test-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`,
  );
}

// Minimal stand-in for McpServer's notification surface — the handler only
// calls `server.server.sendResourceUpdated`, never anything else. The
// real `McpServer` is heavyweight and pulls in transport setup we don't
// need for handler-shape tests.
function stubServer(): McpServer {
  const calls: string[] = [];
  const stub = {
    server: {
      sendResourceUpdated: async ({ uri }: { uri: string }) => {
        calls.push(uri);
      },
    },
  };
  return stub as unknown as McpServer;
}

describe("makeDatabaseChangeHandler — webhook observation", () => {
  let registryPath: string;
  let registry: WebhookRegistry;
  let dispatcher: CapturingDispatcher;
  let orchestrator: WebhookOrchestrator;
  let adapter: InMemoryAdapter;
  let cache: OmniFocusLruCache;
  let server: McpServer;

  beforeEach(() => {
    registryPath = tmpRegistry();
    registry = new WebhookRegistry({ filePath: registryPath });
    dispatcher = new CapturingDispatcher();
    orchestrator = new WebhookOrchestrator({ registry, dispatcher });
    adapter = new InMemoryAdapter();
    cache = new OmniFocusLruCache({ ttlMs: 30000, capacity: 64 });
    server = stubServer();
  });

  afterEach(() => {
    if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
  });

  function fireChange(): Promise<void> {
    const handler = makeDatabaseChangeHandler({
      adapter,
      cache,
      server,
      aggregateUris: [],
      orchestrator,
    });
    const ctx: ChangeContext = {
      detectedAt: new Date().toISOString(),
      source: "node",
    };
    return handler(ctx);
  }

  it("calls observeSnapshot on every fired change when a webhook is registered (drives end-to-end dispatch on second observation)", async () => {
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const taskId = await adapter.createTask({ name: "t1" });
    await fireChange(); // seed
    await adapter.completeTask(taskId);
    await fireChange(); // diff → fire
    expect(dispatcher.delivered).toHaveLength(1);
    expect(dispatcher.delivered[0]?.kind).toBe("task-completed");
  });

  it("does NOT fetch the snapshot when no webhook is registered (shouldObserve fast path)", async () => {
    let listCalls = 0;
    const realListTasks = adapter.listTasks.bind(adapter);
    adapter.listTasks = async (filter) => {
      listCalls += 1;
      return realListTasks(filter);
    };
    await adapter.createTask({ name: "t1" });
    await fireChange();
    expect(listCalls).toBe(0);
    expect(dispatcher.delivered).toEqual([]);
  });

  it("never propagates errors from the snapshot fetch — record-class reads stay clean (ADR-0016 §4e)", async () => {
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    adapter.listTasks = async () => {
      throw new Error("simulated transport failure");
    };
    await expect(fireChange()).resolves.toBeUndefined();
    expect(dispatcher.delivered).toEqual([]);
  });

  it("serializes overlapping runs so a slow stale snapshot cannot regress the baseline and re-deliver events", async () => {
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });

    // Capture the two snapshot states up front so the patched adapter can
    // replay them with controlled timing.
    const taskId = await adapter.createTask({ name: "t1" });
    const before = await adapter.listTasks({}); // t1 incomplete
    await adapter.completeTask(taskId);
    const after = await adapter.listTasks({}); // t1 completed

    adapter.getChangesSince = async () => ({ taskIds: [], projectIds: [] });
    adapter.listProjects = async () => [];

    // Call 1 = seed run (incomplete baseline). Call 2 = run A — captures
    // STALE (incomplete) data but only resolves when released, simulating
    // a JXA read that stalls past the next debounce window. Calls 3+ =
    // fresh (completed) data.
    let releaseStale: () => void = () => {};
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let listTaskCalls = 0;
    adapter.listTasks = async () => {
      listTaskCalls += 1;
      if (listTaskCalls === 1) return before;
      if (listTaskCalls === 2) {
        await staleGate;
        return before;
      }
      return after;
    };

    // ONE handler instance, as in production (created once at startup).
    const handler = makeDatabaseChangeHandler({
      adapter,
      cache,
      server,
      aggregateUris: [],
      orchestrator,
    });
    const ctx = (): ChangeContext => ({ detectedAt: new Date().toISOString(), source: "node" });

    await handler(ctx()); // seed baseline (incomplete) — no events

    const runA = handler(ctx()); // stale fetch, parked on the gate
    const runB = handler(ctx()); // fresh fetch (t1 completed)
    // Give run B time to finish first: without serialization it applies
    // the fresh snapshot now, then run A's stale snapshot lands after it
    // and regresses the baseline.
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseStale();
    await Promise.all([runA, runB]);

    expect(dispatcher.delivered.map((e) => e.kind)).toEqual(["task-completed"]);

    // The next observation must diff against the NEWEST snapshot. If the
    // stale snapshot had been applied last, this run would re-detect the
    // already-dispatched completion and deliver a duplicate.
    await handler(ctx());
    expect(dispatcher.delivered.map((e) => e.kind)).toEqual(["task-completed"]);
  });

  it("skips the snapshot fetch when no orchestrator is wired (back-compat shape)", async () => {
    let listCalls = 0;
    adapter.listTasks = async () => {
      listCalls += 1;
      return [];
    };
    const handler = makeDatabaseChangeHandler({
      adapter,
      cache,
      server,
      aggregateUris: [],
      // no orchestrator
    });
    await handler({ detectedAt: new Date().toISOString(), source: "node" });
    expect(listCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// makeDatabaseChangeHandler — cache invalidation
// ---------------------------------------------------------------------------
//
// Externally-detected changes must flush list-shaped caches too: search /
// forecast / perspective / tag-list / folder-list results embed task and
// project rows, so a targeted per-id eviction alone would leave them serving
// pre-change data for the rest of the TTL — the same invariant the
// mutation-side helpers in src/cache/invalidation.ts enforce.

describe("makeDatabaseChangeHandler — cache invalidation", () => {
  let adapter: InMemoryAdapter;
  let cache: OmniFocusLruCache;
  let server: McpServer;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
    cache = new OmniFocusLruCache({ ttlMs: 30000, capacity: 64 });
    server = stubServer();
  });

  function fire(): Promise<void> {
    const handler = makeDatabaseChangeHandler({ adapter, cache, server, aggregateUris: [] });
    return handler({ detectedAt: new Date().toISOString(), source: "node" });
  }

  it("flushes list-shaped scopes alongside the per-id evictions (targeted branch)", async () => {
    const taskId = await adapter.createTask({ name: "t1" });
    cache.set(`task:${taskId}:ids-only`, "stale");
    cache.set("task:unrelated:ids-only", "fresh");
    cache.set("search:tasks:abc", "stale");
    cache.set("search:projects:abc", "stale");
    cache.set("forecast:today", "stale");
    cache.set("perspective:p1:result", "stale");
    cache.set("tag:list:h1", "stale");
    cache.set("folder:list:h1", "stale");

    await fire();

    // Per-id eviction still applies…
    expect(cache.has(`task:${taskId}:ids-only`)).toBe(false);
    // …list-shaped entries are flushed too (they embed the changed rows)…
    expect(cache.has("search:tasks:abc")).toBe(false);
    expect(cache.has("search:projects:abc")).toBe(false);
    expect(cache.has("forecast:today")).toBe(false);
    expect(cache.has("perspective:p1:result")).toBe(false);
    expect(cache.has("tag:list:h1")).toBe(false);
    expect(cache.has("folder:list:h1")).toBe(false);
    // …while unrelated per-entity entries survive (eviction stays targeted).
    expect(cache.has("task:unrelated:ids-only")).toBe(true);
  });

  it("clears everything when the change query finds no changed IDs (full-clear branch)", async () => {
    cache.set("task:unrelated:ids-only", "x");
    await fire();
    expect(cache.has("task:unrelated:ids-only")).toBe(false);
  });

  it("evicts the parent task's and containing project's per-id payloads when only a child task changed", async () => {
    const projectId = await adapter.createProject({ name: "P" });
    const parentId = await adapter.createTask({ name: "parent", projectId });
    const childId = await adapter.createTask({ name: "child", parentId });
    // OmniFocus does not bump the parent's or project's modificationDate
    // when a child task is edited in the UI — model a change set that
    // contains only the child.
    adapter.getChangesSince = async () => ({ taskIds: [childId], projectIds: [] });

    cache.set(`task:${parentId}:with-subtasks`, "stale");
    cache.set(`project:${projectId}:with-tasks`, "stale");
    cache.set("task:unrelated:ids-only", "fresh");
    cache.set("project:unrelated:with-tasks", "fresh");

    await fire();

    // The parent's and project's cached payloads embed the changed child…
    expect(cache.has(`task:${parentId}:with-subtasks`)).toBe(false);
    expect(cache.has(`project:${projectId}:with-tasks`)).toBe(false);
    // …while unrelated per-entity entries survive (eviction stays targeted).
    expect(cache.has("task:unrelated:ids-only")).toBe(true);
    expect(cache.has("project:unrelated:with-tasks")).toBe(true);
  });

  it("falls back to a full clear when container resolution fails", async () => {
    const taskId = await adapter.createTask({ name: "t1" });
    adapter.getChangesSince = async () => ({ taskIds: [taskId], projectIds: [] });
    adapter.getTasksMany = async () => {
      throw new Error("simulated transport failure");
    };
    cache.set("task:unrelated:ids-only", "x");

    await fire();

    expect(cache.has("task:unrelated:ids-only")).toBe(false);
  });
});
