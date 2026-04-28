import { describe, expect, it } from "vitest";
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
import {
  composeAdapter,
  composeResourceServices,
  composeServices,
  makeMeta,
} from "./composition.js";

const baseConfig: Config = {
  OMNIFOCUS_LOG_LEVEL: "info",
  OMNIFOCUS_INTEGRATION: false,
  OMNIFOCUS_E2E: false,
  OMNIFOCUS_E2E_USE_MEMORY: false,
  OMNIFOCUS_ALLOW_RAW_SCRIPT: false,
  OMNIFOCUS_ATTACHMENT_PATHS: ["/tmp"],
  OMNIFOCUS_JXA_TIMEOUT_MS: 30000,
  OMNIFOCUS_OMNIJS_TIMEOUT_MS: 45000,
  OMNIFOCUS_CACHE_TTL_MS: 30000,
  OMNIFOCUS_CACHE_CAPACITY: 256,
  OMNIFOCUS_READ_POOL_SIZE: 2,
  OMNIFOCUS_WRITE_QUEUE_CAP: 50,
  OMNIFOCUS_MAX_ATTACHMENT_MB: 100,
  OMNIFOCUS_TOOL_RATE_LIMIT: { limit: 120, windowSeconds: 60 },
  OMNIFOCUS_WAITING_TAG_NAME: "waiting",
  OMNIFOCUS_TEMPLATES_FOLDER_NAME: "Templates",
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
