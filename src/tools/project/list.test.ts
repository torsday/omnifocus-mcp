/**
 * Tests for the `project_list` tool — schema parsing + handler envelope.
 *
 * Filter/pagination semantics live in `projectService.test.ts` and are not
 * duplicated here. These tests guard the MCP surface and the handler's meta
 * + pagination wiring.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ProjectService } from "../../services/projectService.js";
import { PROJECT_LIST_DESCRIPTION, handleProjectList, projectListInputSchema } from "./list.js";

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

describe("project_list — input schema", () => {
  it("accepts an empty object (service performs the bounded-query gate)", () => {
    expect(projectListInputSchema.parse({})).toEqual({});
  });

  it("accepts the full filter surface", () => {
    const parsed = projectListInputSchema.parse({
      folderId: "folder_000001",
      status: "active",
      flagged: true,
      reviewDueBefore: "2026-05-01T00:00:00Z",
      limit: 50,
      cursor: "opaque",
    });
    expect(parsed.folderId).toBe("folder_000001");
    expect(parsed.status).toBe("active");
  });

  it("rejects an unknown status", () => {
    expect(() => projectListInputSchema.parse({ status: "paused" })).toThrow();
  });

  it("rejects limit > 1000", () => {
    expect(() => projectListInputSchema.parse({ limit: 2000 })).toThrow();
  });

  it("rejects limit < 1", () => {
    expect(() => projectListInputSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects a malformed folderId", () => {
    expect(() => projectListInputSchema.parse({ folderId: "??" })).toThrow();
  });
});

describe("project_list — description", () => {
  it("documents read-only + filter surface + pagination", () => {
    expect(PROJECT_LIST_DESCRIPTION).toMatch(/project/i);
    expect(PROJECT_LIST_DESCRIPTION).toMatch(/no side effects/i);
    expect(PROJECT_LIST_DESCRIPTION).toMatch(/pagination/i);
  });
});

describe("project_list — handler", () => {
  it("returns the ADR-0013 envelope with projects + pagination + cacheHit meta", async () => {
    const { ctx, adapter } = makeCtx();
    await adapter.createProject({ name: "p1" });
    await adapter.createProject({ name: "p2" });

    const envelope = await handleProjectList({ status: "active", limit: 10 }, ctx);
    expect(envelope.data.projects.map((p) => p.name)).toEqual(["p1", "p2"]);
    expect(envelope.pagination?.hasMore).toBe(false);
    expect(envelope.pagination?.cursor).toBeNull();
    expect(envelope.meta.cacheHit).toBe(false);

    const repeat = await handleProjectList({ status: "active", limit: 10 }, ctx);
    expect(repeat.meta.cacheHit).toBe(true);
  });

  it("propagates ValidationError from the service (unbounded query)", async () => {
    const { ctx } = makeCtx();
    await expect(handleProjectList({}, ctx)).rejects.toThrow();
  });
});
