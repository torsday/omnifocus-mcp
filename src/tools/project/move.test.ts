/**
 * Tests for project_move tool.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { FolderId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ProjectService } from "../../services/projectService.js";
import { handleProjectMove, projectMoveInputSchema } from "./move.js";

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

describe("project_move — input schema", () => {
  it("requires id", () => {
    expect(() => projectMoveInputSchema.parse({ folderId: null })).toThrow();
  });

  it("accepts id with a folderId", () => {
    const parsed = projectMoveInputSchema.parse({ id: "project_000001", folderId: "folder_abc" });
    expect(parsed.id).toBe("project_000001");
    expect(parsed.folderId).toBe("folder_abc");
  });

  it("accepts id with folderId null (move to root)", () => {
    const parsed = projectMoveInputSchema.parse({ id: "project_000001", folderId: null });
    expect(parsed.folderId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_move — handler", () => {
  it("returns { moved: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "Target" });
    const id = await adapter.createProject({ name: "Roaming project" });
    const envelope = await handleProjectMove({ id, folderId }, ctx);
    expect(envelope.data.moved).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "F" });
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleProjectMove({ id, folderId }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("pairs name with id in the response (#585)", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "F" });
    const id = await adapter.createProject({ name: "Reorg me" });
    const envelope = await handleProjectMove({ id, folderId }, ctx);
    expect(envelope.data).toMatchObject({ moved: true, id, name: "Reorg me" });
  });

  it("project is in the target folder after move", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "F" });
    const id = await adapter.createProject({ name: "P" });
    await handleProjectMove({ id, folderId }, ctx);
    const project = await adapter.getProject(id);
    expect(project.folderId).toBe(folderId);
  });

  it("moves to root when folderId is null", async () => {
    const { ctx, adapter } = makeCtx();
    const folderId = await adapter.createFolder({ name: "F" });
    const id = await adapter.createProject({ name: "P", folderId });
    await handleProjectMove({ id, folderId: null }, ctx);
    const project = await adapter.getProject(id);
    expect(project.folderId).toBeNull();
  });

  it("throws for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectMove(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId, folderId: null },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_move — cache invalidation", () => {
  it("emits project:${id}, forecast:*, perspective:*, search:*, tag:list, folder:list", async () => {
    const { ctx: base, adapter } = makeCtx();
    const lruCache = new OmniFocusLruCache();
    const scopes = recordScopes(lruCache);
    const folderId = await adapter.createFolder({ name: "F" });
    const id = await adapter.createProject({ name: "P" });

    await handleProjectMove({ id, folderId }, { ...base, cache: lruCache });

    expect(scopes).toEqual([
      `project:${id}`,
      "forecast:*",
      "perspective:*",
      "search:*",
      "tag:list",
      "folder:list",
    ]);
  });

  it("does not invalidate when move fails", async () => {
    const { ctx: base } = makeCtx();
    const lruCache = new OmniFocusLruCache();
    const scopes = recordScopes(lruCache);
    await expect(
      handleProjectMove(
        {
          id: "project_999999" as import("../../domain/ids.js").ProjectId,
          folderId: "folder_abc" as FolderId,
        },
        { ...base, cache: lruCache },
      ),
    ).rejects.toThrow();
    expect(scopes).toEqual([]);
  });
});
