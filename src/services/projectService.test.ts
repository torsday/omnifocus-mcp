/**
 * Unit tests for `ProjectService.list` and `ProjectService.get`.
 *
 * Contract verified here:
 * - Filter plumbing (folderId + status pushed to adapter; flagged +
 *   reviewDueBefore post-filtered in-service).
 * - Unbounded query rejection (no filter/limit/cursor → ValidationError).
 * - Pagination stable under `(createdAt ASC, id ASC)`; cursor round-trip;
 *   filter-hash mismatch rejects.
 * - Cache layer consulted (hit/miss) with short-circuit on identical repeat.
 * - `get` attaches tasks only when `includeTaskTree` is true (default).
 *
 * Uses `InMemoryAdapter` + real `OmniFocusLruCache` with a monotonic clock
 * so every created project has a distinct `createdAt` and ordering is
 * deterministic.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { FolderId } from "../domain/ids.js";
import { ValidationError } from "../errors/index.js";
import { ProjectService } from "./projectService.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeHarness(): {
  service: ProjectService;
  adapter: InMemoryAdapter;
  cache: OmniFocusLruCache;
} {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
  const service = new ProjectService({ adapter, cache });
  return { service, adapter, cache };
}

// ---------------------------------------------------------------------------
// Validation gate
// ---------------------------------------------------------------------------

describe("ProjectService.list — validation gate", () => {
  it("rejects fully unbounded queries", async () => {
    const { service } = makeHarness();
    const err = await service.list({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).suggestion).toBe("Provide a filter or a limit.");
  });

  it("accepts a call with only limit", async () => {
    const { service } = makeHarness();
    const out = await service.list({ limit: 10 });
    expect(out.projects).toEqual([]);
    expect(out.hasMore).toBe(false);
  });

  it("accepts a call with only a filter", async () => {
    const { service } = makeHarness();
    const out = await service.list({ flagged: true });
    expect(out.projects).toEqual([]);
  });

  it("rejects non-integer limit", async () => {
    const { service } = makeHarness();
    await expect(service.list({ limit: 1.5 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects limit below 1", async () => {
    const { service } = makeHarness();
    await expect(service.list({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects limit above 1000", async () => {
    const { service } = makeHarness();
    await expect(service.list({ limit: 1001 })).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Filter plumbing
// ---------------------------------------------------------------------------

describe("ProjectService.list — filters", () => {
  it("pushes folderId + status down to the adapter", async () => {
    const { service, adapter } = makeHarness();
    const folder = await adapter.createFolder({ name: "F" });
    await adapter.createProject({ name: "in-folder", folderId: folder });
    await adapter.createProject({ name: "loose" });

    const spy = vi.spyOn(adapter, "listProjects");
    const out = await service.list({ folderId: folder, status: "active" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: folder, status: "active" }),
    );
    expect(out.projects.map((p) => p.name)).toEqual(["in-folder"]);
  });

  it("post-filters flagged in-service (adapter doesn't accept it)", async () => {
    const { service, adapter } = makeHarness();
    const flaggedId = await adapter.createProject({ name: "flag" });
    await adapter.createProject({ name: "plain" });
    await adapter.updateProject(flaggedId, { flagged: true });

    const spy = vi.spyOn(adapter, "listProjects");
    const out = await service.list({ flagged: true });
    expect((spy.mock.calls[0]?.[0] as { flagged?: unknown } | undefined)?.flagged).toBeUndefined();
    expect(out.projects.map((p) => p.name)).toEqual(["flag"]);
  });

  it("post-filters reviewDueBefore; excludes projects without a review interval", async () => {
    const { service, adapter } = makeHarness();
    const a = await adapter.createProject({ name: "soon" });
    const b = await adapter.createProject({ name: "later" });
    await adapter.createProject({ name: "no-review" });
    // markProjectReviewed sets nextReviewDate = now + reviewIntervalDays.
    // With a monotonic clock anchored at 2026-01-01, 1 day ≈ Jan 2, 180 days ≈ Jun 30.
    await adapter.updateProject(a, { reviewIntervalDays: 1 });
    await adapter.markProjectReviewed(a);
    await adapter.updateProject(b, { reviewIntervalDays: 180 });
    await adapter.markProjectReviewed(b);

    const out = await service.list({ reviewDueBefore: "2026-05-01T00:00:00Z" });
    expect(out.projects.map((p) => p.name)).toEqual(["soon"]);
  });

  it("combines status + flagged filters (adapter + post-filter)", async () => {
    const { service, adapter } = makeHarness();
    const activeFlaggedId = await adapter.createProject({ name: "active-flag" });
    const onHoldFlaggedId = await adapter.createProject({ name: "on-hold-flag" });
    await adapter.updateProject(activeFlaggedId, { flagged: true });
    await adapter.updateProject(onHoldFlaggedId, { flagged: true, status: "on-hold" });

    const out = await service.list({ status: "active", flagged: true });
    expect(out.projects.map((p) => p.name)).toEqual(["active-flag"]);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("ProjectService.list — pagination", () => {
  it("splits across pages and emits a cursor when more remain", async () => {
    const { service, adapter } = makeHarness();
    for (let i = 0; i < 5; i++) await adapter.createProject({ name: `p${i}` });

    const page1 = await service.list({ status: "active", limit: 2 });
    expect(page1.projects.map((p) => p.name)).toEqual(["p0", "p1"]);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.list({
      status: "active",
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(page2.projects.map((p) => p.name)).toEqual(["p2", "p3"]);
    expect(page2.hasMore).toBe(true);

    const page3 = await service.list({
      status: "active",
      limit: 2,
      cursor: page2.nextCursor as string,
    });
    expect(page3.projects.map((p) => p.name)).toEqual(["p4"]);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
  });

  it("rejects a cursor whose filter-hash no longer matches the current query", async () => {
    const { service, adapter } = makeHarness();
    for (let i = 0; i < 3; i++) await adapter.createProject({ name: `p${i}` });
    const page1 = await service.list({ status: "active", limit: 1 });
    await expect(
      service.list({
        status: "on-hold",
        limit: 1,
        cursor: page1.nextCursor as string,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("malformed cursor → ValidationError", async () => {
    const { service } = makeHarness();
    await expect(service.list({ flagged: true, cursor: "???" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("returns empty page + null cursor when nothing matches", async () => {
    const { service } = makeHarness();
    const out = await service.list({ flagged: true, limit: 10 });
    expect(out.projects).toEqual([]);
    expect(out.nextCursor).toBeNull();
    expect(out.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe("ProjectService.list — cache", () => {
  it("reports cacheHit=false then true on identical repeat", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createProject({ name: "p" });
    const first = await service.list({ status: "active", limit: 10 });
    const second = await service.list({ status: "active", limit: 10 });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.projects).toEqual(first.projects);
  });

  it("repeat call does not re-query the adapter", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createProject({ name: "p" });
    const spy = vi.spyOn(adapter, "listProjects");
    await service.list({ status: "active", limit: 10 });
    await service.list({ status: "active", limit: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("same filters with a different limit do not share a cache entry", async () => {
    const { service, adapter } = makeHarness();
    for (let i = 0; i < 4; i++) await adapter.createProject({ name: `p${i}` });
    const first = await service.list({ status: "active", limit: 2 });
    expect(first.projects).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    // Re-issuing with a larger limit must not serve the stale limit-2 page.
    const second = await service.list({ status: "active", limit: 4 });
    expect(second.cacheHit).toBe(false);
    expect(second.projects).toHaveLength(4);
    expect(second.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("ProjectService.get", () => {
  it("returns the project and its tasks by default (includeTaskTree=true)", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "t1", projectId: p });
    await adapter.createTask({ name: "t2", projectId: p });

    const out = await service.get({ id: p });
    expect(out.project.id).toBe(p);
    expect(out.tasks?.map((t) => t.name).sort()).toEqual(["t1", "t2"]);
  });

  it("omits tasks when includeTaskTree=false", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "t1", projectId: p });

    const out = await service.get({ id: p, includeTaskTree: false });
    expect(out.project.id).toBe(p);
    expect(out.tasks).toBeUndefined();
  });

  it("throws NotFound for unknown ID", async () => {
    const { service } = makeHarness();
    await expect(
      service.get({ id: "proj_999999" as import("../domain/ids.js").ProjectId }),
    ).rejects.toThrow();
  });

  it("caches the result; repeat call short-circuits the adapter", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    const spy = vi.spyOn(adapter, "getProject");
    const first = await service.get({ id: p });
    const second = await service.get({ id: p });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("caches with-tasks and solo variants separately", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    const spy = vi.spyOn(adapter, "getProject");
    await service.get({ id: p, includeTaskTree: true });
    await service.get({ id: p, includeTaskTree: false });
    // Distinct cache keys → adapter hit for each variant
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("ProjectService — _links opt-in", () => {
  it("get() omits _links by default", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    const out = await service.get({ id: p });
    expect(out.project._links).toBeUndefined();
  });

  it("get() includes _links on project and tasks when includeLinks=true", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "t1", projectId: p });
    const out = await service.get({ id: p, includeLinks: true });
    expect(out.project._links?.self).toBe(`omnifocus://project/${p}`);
    expect(out.tasks?.[0]?._links).toBeDefined();
  });

  it("list() omits _links by default", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createProject({ name: "A" });
    const out = await service.list({ limit: 10 });
    expect(out.projects[0]?._links).toBeUndefined();
  });

  it("list() includes _links when includeLinks=true", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "A" });
    const out = await service.list({ limit: 10, includeLinks: true });
    expect(out.projects[0]?._links?.self).toBe(`omnifocus://project/${p}`);
  });

  it("toggling includeLinks does not fragment the get() cache", async () => {
    const { service, adapter } = makeHarness();
    const p = await adapter.createProject({ name: "P" });
    const spy = vi.spyOn(adapter, "getProject");
    await service.get({ id: p });
    await service.get({ id: p, includeLinks: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Type-level smoke: FolderId filter is the branded type
// ---------------------------------------------------------------------------

describe("ProjectService — type plumbing", () => {
  it("accepts a branded FolderId in the filter", async () => {
    const { service, adapter } = makeHarness();
    const folder = (await adapter.createFolder({ name: "F" })) satisfies FolderId;
    await expect(service.list({ folderId: folder })).resolves.toBeTruthy();
  });
});
