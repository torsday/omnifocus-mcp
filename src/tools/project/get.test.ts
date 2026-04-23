/**
 * Tests for the `project_get` tool — schema parsing + handler envelope.
 *
 * Service-layer task-attachment logic lives in `projectService.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ProjectService } from "../../services/projectService.js";
import { PROJECT_GET_DESCRIPTION, handleProjectGet, projectGetInputSchema } from "./get.js";

function makeCtx() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
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

describe("project_get — input schema", () => {
  it("requires id", () => {
    expect(() => projectGetInputSchema.parse({})).toThrow();
  });

  it("accepts id and defaulted includeTaskTree", () => {
    const parsed = projectGetInputSchema.parse({ id: "proj_000001" });
    expect(parsed.id).toBe("proj_000001");
    expect(parsed.includeTaskTree).toBeUndefined();
  });

  it("accepts includeTaskTree=false", () => {
    const parsed = projectGetInputSchema.parse({ id: "proj_000001", includeTaskTree: false });
    expect(parsed.includeTaskTree).toBe(false);
  });

  it("rejects a malformed id", () => {
    expect(() => projectGetInputSchema.parse({ id: "??" })).toThrow();
  });
});

describe("project_get — description", () => {
  it("mentions includeTaskTree default and read-only intent", () => {
    expect(PROJECT_GET_DESCRIPTION).toMatch(/includeTaskTree/);
    expect(PROJECT_GET_DESCRIPTION).toMatch(/no side effects/i);
  });
});

describe("project_get — handler", () => {
  it("returns { project, tasks } by default", async () => {
    const { ctx, adapter } = makeCtx();
    const p = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "t1", projectId: p });

    const envelope = await handleProjectGet({ id: p }, ctx);
    expect(envelope.data.project.id).toBe(p);
    expect(envelope.data.tasks?.map((t) => t.name)).toEqual(["t1"]);
  });

  it("omits tasks when includeTaskTree=false", async () => {
    const { ctx, adapter } = makeCtx();
    const p = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "t1", projectId: p });

    const envelope = await handleProjectGet({ id: p, includeTaskTree: false }, ctx);
    expect(envelope.data.project.id).toBe(p);
    expect(envelope.data.tasks).toBeUndefined();
  });

  it("propagates NotFound for an unknown ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectGet({ id: "proj_999999" as import("../../domain/ids.js").ProjectId }, ctx),
    ).rejects.toThrow();
  });

  it("reports cacheHit on repeat calls", async () => {
    const { ctx, adapter } = makeCtx();
    const p = await adapter.createProject({ name: "P" });

    const first = await handleProjectGet({ id: p }, ctx);
    const second = await handleProjectGet({ id: p }, ctx);
    expect(first.meta.cacheHit).toBe(false);
    expect(second.meta.cacheHit).toBe(true);
  });
});
