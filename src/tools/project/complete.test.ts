/**
 * Tests for project_complete tool.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ProjectService } from "../../services/projectService.js";
import {
  handleProjectComplete,
  PROJECT_COMPLETE_DESCRIPTION,
  projectCompleteInputSchema,
} from "./complete.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = { wrap: <T>(_k: string, f: () => Promise<T>) => f(), has: () => false };
  const projectService = new ProjectService({ adapter, cache });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { projectService, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_complete — input schema", () => {
  it("requires id", () => {
    expect(() => projectCompleteInputSchema.parse({})).toThrow();
  });

  it("accepts a valid project ID", () => {
    const parsed = projectCompleteInputSchema.parse({ id: "project_000001" });
    expect(parsed.id).toBe("project_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_complete — handler", () => {
  it("returns { completed: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Finish me" });
    const envelope = await handleProjectComplete({ id }, ctx);
    expect(envelope.data.completed).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleProjectComplete({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("project status is done after completing", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleProjectComplete({ id }, ctx);
    const project = await adapter.getProject(id);
    expect(project.status).toBe("done");
  });

  it("throws for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectComplete(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("tool description mentions 'complete'", () => {
    expect(PROJECT_COMPLETE_DESCRIPTION.toLowerCase()).toContain("complete");
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_complete — cache invalidation", () => {
  it("emits project:${id}, forecast:*, perspective:*, search:*", async () => {
    const { ctx: base, adapter } = makeCtx();
    const lruCache = new OmniFocusLruCache();
    const scopes = recordScopes(lruCache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectComplete({ id }, { ...base, cache: lruCache });

    expect(scopes).toEqual([`project:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("does not invalidate when complete fails", async () => {
    const { ctx: base } = makeCtx();
    const lruCache = new OmniFocusLruCache();
    const scopes = recordScopes(lruCache);
    await expect(
      handleProjectComplete(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId },
        { ...base, cache: lruCache },
      ),
    ).rejects.toThrow();
    expect(scopes).toEqual([]);
  });
});
