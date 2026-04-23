/**
 * Tests for project_update tool.
 *
 * Covers: schema validation, successful update, nullable field clearing,
 * cache invalidation, and response shape.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleProjectUpdate, projectUpdateInputSchema } from "./update.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scope: InvalidationScope }) => {
    scopes.push(e.scope);
  });
  return scopes;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return { ctx: { adapter, makeMeta }, adapter };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_update — input schema", () => {
  it("requires id", () => {
    expect(() => projectUpdateInputSchema.parse({})).toThrow();
  });

  it("accepts id only (no-op patch)", () => {
    const parsed = projectUpdateInputSchema.parse({ id: "project_000001" });
    expect(parsed.id).toBe("project_000001");
  });

  it("accepts nullable note (null = clear)", () => {
    const parsed = projectUpdateInputSchema.parse({ id: "project_000001", note: null });
    expect(parsed.note).toBeNull();
  });

  it("rejects empty name", () => {
    expect(() => projectUpdateInputSchema.parse({ id: "project_000001", name: "" })).toThrow();
  });

  it("rejects invalid status", () => {
    expect(() =>
      projectUpdateInputSchema.parse({ id: "project_000001", status: "dropped" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_update — handler", () => {
  it("updates a project and returns { updated: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Original" });

    const envelope = await handleProjectUpdate({ id, name: "Updated" }, ctx);

    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = await handleProjectUpdate({ id }, ctx);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("adapter receives the name patch", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Before" });
    await handleProjectUpdate({ id, name: "After" }, ctx);
    const project = await adapter.getProject(id);
    expect(project.name).toBe("After");
  });

  it("adapter receives the flagged patch", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P", flagged: false });
    await handleProjectUpdate({ id, flagged: true }, ctx);
    const project = await adapter.getProject(id);
    expect(project.flagged).toBe(true);
  });

  it("adapter receives the status patch", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P", status: "active" });
    await handleProjectUpdate({ id, status: "on-hold" }, ctx);
    const project = await adapter.getProject(id);
    expect(project.status).toBe("on-hold");
  });

  it("omitted fields are not changed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Keep Me", flagged: true });
    await handleProjectUpdate({ id, status: "on-hold" }, ctx);
    const project = await adapter.getProject(id);
    expect(project.name).toBe("Keep Me");
    expect(project.flagged).toBe(true);
  });

  it("throws NotFound for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectUpdate(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId, name: "X" },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("project_update — cache invalidation", () => {
  it("emits project:${id}, forecast:*, perspective:*, search:*", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectUpdate({ id }, { ...base, cache });

    expect(scopes).toEqual([`project:${id}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("does not invalidate when update fails (NotFound)", async () => {
    const { ctx: base } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    await expect(
      handleProjectUpdate(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId },
        { ...base, cache },
      ),
    ).rejects.toThrow();
    expect(scopes).toEqual([]);
  });
});
