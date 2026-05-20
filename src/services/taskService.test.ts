/**
 * Unit tests for `TaskService.list` and `TaskService.get`.
 *
 * Contract verified here:
 * - Filter plumbing matches the adapter semantics (single-tag pushed down,
 *   multi-tag intersected post-fetch, `completed` mode mapped to boolean).
 * - Pagination is stable under `(createdAt ASC, id ASC)` sort; cursors
 *   round-trip; filter-hash mismatch rejects.
 * - Unbounded queries throw `ValidationError` with the canonical suggestion.
 * - The cache layer is consulted (hit/miss) and a second identical call
 *   returns `cacheHit: true` without re-hitting the adapter.
 * - `get` returns the task + subtasks, caches results, and throws `NotFound`
 *   for unknown IDs; `includeSubtasks=false` omits the subtasks list.
 *
 * All tests use `InMemoryAdapter` and the real `OmniFocusLruCache` — no
 * mocks beyond clock injection. The service's contract is the value being
 * tested, not its internal call-graph.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { OmniFocusLruCache } from "../cache/lruCache.js";
import type { ProjectId, TagId, TaskId } from "../domain/ids.js";
import { NotFound, ValidationError } from "../errors/index.js";
import { type TaskListInput, TaskService } from "./taskService.js";

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/**
 * Build an adapter + cache + service, with a strictly-monotonic clock so
 * every created task has a distinct `createdAt` (and thus a deterministic
 * `(createdAt ASC, id ASC)` order under pagination).
 */
function makeHarness(): {
  service: TaskService;
  adapter: InMemoryAdapter;
  cache: OmniFocusLruCache;
} {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
  const service = new TaskService({ adapter, cache });
  return { service, adapter, cache };
}

async function seedTags(adapter: InMemoryAdapter, names: string[]): Promise<TagId[]> {
  const out: TagId[] = [];
  for (const name of names) out.push(await adapter.createTag({ name }));
  return out;
}

async function seedProject(adapter: InMemoryAdapter, name: string): Promise<ProjectId> {
  return adapter.createProject({ name });
}

// ---------------------------------------------------------------------------
// Validation gate
// ---------------------------------------------------------------------------

describe("TaskService.list — validation gate", () => {
  it("rejects fully unbounded queries with the documented suggestion", async () => {
    const { service } = makeHarness();
    const err = await service.list({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).suggestion).toBe("Provide a filter or a limit.");
  });

  it("accepts a call with only limit (no filter, no cursor)", async () => {
    const { service } = makeHarness();
    const out = await service.list({ limit: 10 });
    expect(out.tasks).toEqual([]);
    expect(out.hasMore).toBe(false);
  });

  it("accepts a call with only a filter (no limit, no cursor)", async () => {
    const { service } = makeHarness();
    const out = await service.list({ flagged: true });
    expect(out.tasks).toEqual([]);
  });

  it("rejects empty tagIds array as 'no filter'", async () => {
    const { service } = makeHarness();
    await expect(service.list({ tagIds: [] })).rejects.toBeInstanceOf(ValidationError);
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

describe("TaskService.list — filters", () => {
  it("applies flagged, completed=exclude (default intent), and projectId", async () => {
    const { service, adapter } = makeHarness();
    const projA = await seedProject(adapter, "A");
    const projB = await seedProject(adapter, "B");
    const aFlagged = await adapter.createTask({ name: "a-flag", projectId: projA, flagged: true });
    await adapter.createTask({ name: "a-plain", projectId: projA });
    await adapter.createTask({ name: "b-flag", projectId: projB, flagged: true });
    await adapter.completeTask(aFlagged);

    const out = await service.list({
      projectId: projA,
      flagged: true,
      completed: "exclude",
    });
    expect(out.tasks.map((t) => t.name)).toEqual([]); // the only flagged A task is completed

    const any = await service.list({
      projectId: projA,
      flagged: true,
      completed: "any",
    });
    expect(any.tasks.map((t) => t.name)).toEqual(["a-flag"]);

    const only = await service.list({ projectId: projA, completed: "only" });
    expect(only.tasks.map((t) => t.name)).toEqual(["a-flag"]);
  });

  it("pushes a single-element tagIds down to the adapter.tagId filter", async () => {
    const { service, adapter } = makeHarness();
    const [t1, t2] = await seedTags(adapter, ["home", "work"]);
    await adapter.createTask({ name: "at-home", tagIds: [t1 as TagId] });
    await adapter.createTask({ name: "at-work", tagIds: [t2 as TagId] });
    await adapter.createTask({ name: "anywhere" });

    const spy = vi.spyOn(adapter, "listTasks");
    const out = await service.list({ tagIds: [t1 as TagId] });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ tagId: t1 }));
    expect(out.tasks.map((t) => t.name)).toEqual(["at-home"]);
  });

  it("intersects multi-tag filters in-service (tagIds.length > 1)", async () => {
    const { service, adapter } = makeHarness();
    const [home, urgent] = await seedTags(adapter, ["home", "urgent"]);
    await adapter.createTask({ name: "home-only", tagIds: [home as TagId] });
    await adapter.createTask({ name: "urgent-only", tagIds: [urgent as TagId] });
    await adapter.createTask({
      name: "both",
      tagIds: [home as TagId, urgent as TagId],
    });

    const spy = vi.spyOn(adapter, "listTasks");
    const out = await service.list({ tagIds: [home as TagId, urgent as TagId] });

    // Adapter should not receive a tagId filter — service post-filters.
    expect((spy.mock.calls[0]?.[0] as { tagId?: unknown } | undefined)?.tagId).toBeUndefined();
    expect(out.tasks.map((t) => t.name)).toEqual(["both"]);
  });

  it("forwards date-range filters unchanged to the adapter", async () => {
    const { service, adapter } = makeHarness();
    const spy = vi.spyOn(adapter, "listTasks");
    await service.list({
      dueBefore: "2026-05-01T00:00:00Z",
      dueAfter: "2026-04-01T00:00:00Z",
      deferredBefore: "2026-04-15T00:00:00Z",
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        dueBefore: "2026-05-01T00:00:00Z",
        dueAfter: "2026-04-01T00:00:00Z",
        deferredBefore: "2026-04-15T00:00:00Z",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe("TaskService.list — pagination", () => {
  it("splits across pages of the requested limit and emits a cursor when more remain", async () => {
    const { service, adapter } = makeHarness();
    for (let i = 0; i < 5; i++) {
      await adapter.createTask({ name: `t${i}`, flagged: true });
    }
    const page1 = await service.list({ flagged: true, limit: 2 });
    expect(page1.tasks.map((t) => t.name)).toEqual(["t0", "t1"]);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.list({
      flagged: true,
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(page2.tasks.map((t) => t.name)).toEqual(["t2", "t3"]);
    expect(page2.hasMore).toBe(true);

    const page3 = await service.list({
      flagged: true,
      limit: 2,
      cursor: page2.nextCursor as string,
    });
    expect(page3.tasks.map((t) => t.name)).toEqual(["t4"]);
    expect(page3.hasMore).toBe(false);
    expect(page3.nextCursor).toBeNull();
  });

  it("rejects a cursor whose filter-hash no longer matches the current query", async () => {
    const { service, adapter } = makeHarness();
    for (let i = 0; i < 3; i++) await adapter.createTask({ name: `t${i}`, flagged: true });
    const page1 = await service.list({ flagged: true, limit: 1 });
    await expect(
      service.list({
        flagged: false,
        limit: 1,
        cursor: page1.nextCursor as string,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("filter hash is stable under tagIds reordering (so cursor survives)", async () => {
    const { service, adapter } = makeHarness();
    const [a, b] = await seedTags(adapter, ["a", "b"]);
    for (let i = 0; i < 3; i++) {
      await adapter.createTask({ name: `t${i}`, tagIds: [a as TagId, b as TagId] });
    }
    const page1 = await service.list({ tagIds: [a as TagId, b as TagId], limit: 2 });
    // Second call uses the reordered array; cursor must still match.
    const page2 = await service.list({
      tagIds: [b as TagId, a as TagId],
      limit: 2,
      cursor: page1.nextCursor as string,
    });
    expect(page2.tasks.map((t) => t.name)).toEqual(["t2"]);
  });

  it("returns empty page + null cursor when nothing matches", async () => {
    const { service } = makeHarness();
    const out = await service.list({ flagged: true, limit: 10 });
    expect(out.tasks).toEqual([]);
    expect(out.nextCursor).toBeNull();
    expect(out.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------

describe("TaskService.list — cache", () => {
  it("reports cacheHit=false on first call and cacheHit=true on an identical repeat", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createTask({ name: "a", flagged: true });
    const first = await service.list({ flagged: true, limit: 10 });
    const second = await service.list({ flagged: true, limit: 10 });
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.tasks).toEqual(first.tasks);
  });

  it("repeat call does not re-query the adapter (cache short-circuit)", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createTask({ name: "a", flagged: true });
    const spy = vi.spyOn(adapter, "listTasks");
    await service.list({ flagged: true, limit: 10 });
    await service.list({ flagged: true, limit: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("different filters produce different cache keys (no cross-talk)", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createTask({ name: "a", flagged: true });
    const spy = vi.spyOn(adapter, "listTasks");
    await service.list({ flagged: true, limit: 10 });
    await service.list({ flagged: false, limit: 10 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("toggling includeLinks does not fragment the cache", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createTask({ name: "a", flagged: true });
    const spy = vi.spyOn(adapter, "listTasks");
    await service.list({ flagged: true, limit: 10 });
    await service.list({ flagged: true, limit: 10, includeLinks: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("TaskService.list — _links opt-in", () => {
  it("omits _links by default", async () => {
    const { service, adapter } = makeHarness();
    await adapter.createTask({ name: "a", flagged: true });
    const result = await service.list({ flagged: true, limit: 10 });
    expect(result.tasks[0]?._links).toBeUndefined();
  });

  it("includes _links when includeLinks=true", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "a", flagged: true })) as TaskId;
    const result = await service.list({ flagged: true, limit: 10, includeLinks: true });
    expect(result.tasks[0]?._links?.self).toBe(`omnifocus://task/${id}`);
  });
});

// ---------------------------------------------------------------------------
// Contract — substitutability over OmniFocusAdapter
// ---------------------------------------------------------------------------

describe("TaskService.list — adapter substitutability", () => {
  it("works against any OmniFocusAdapter — only `listTasks` is needed for list()", async () => {
    const adapter = new InMemoryAdapter();
    const spy = vi.spyOn(adapter, "listTasks").mockResolvedValue([]);
    const cache = new OmniFocusLruCache({ ttlMs: 30_000 });
    const service = new TaskService({ adapter: adapter as OmniFocusAdapter, cache });
    const input: TaskListInput = { flagged: true };
    const out = await service.list(input);
    expect(out.tasks).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TaskService.get — happy path, subtask toggle, error paths, cache
// ---------------------------------------------------------------------------

describe("TaskService.get — happy path", () => {
  it("returns subtaskIds by default (includeSubtasks omitted)", async () => {
    const { service, adapter } = makeHarness();
    const parentId = (await adapter.createTask({ name: "Parent" })) as TaskId;
    const childId = (await adapter.createTask({ name: "Child", parentId })) as TaskId;
    const result = await service.get({ id: parentId });
    expect(result.task.id).toBe(parentId);
    expect(result.task.name).toBe("Parent");
    expect(result.subtasks).toBeUndefined();
    expect(result.subtaskIds).toEqual([childId]);
    expect(result.subtaskCount).toBe(1);
  });

  it("returns full subtask bodies when includeSubtasks=true", async () => {
    const { service, adapter } = makeHarness();
    const parentId = (await adapter.createTask({ name: "Parent" })) as TaskId;
    await adapter.createTask({ name: "Child", parentId });
    const result = await service.get({ id: parentId, includeSubtasks: true });
    expect(result.task.id).toBe(parentId);
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks?.[0]?.name).toBe("Child");
    expect(result.subtaskIds).toBeUndefined();
  });

  it("returns empty subtaskIds array when task has no children", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "Leaf" })) as TaskId;
    const result = await service.get({ id });
    expect(result.subtaskIds).toEqual([]);
    expect(result.subtaskCount).toBe(0);
    expect(result.subtasks).toBeUndefined();
  });

  it("omits _links by default (includeLinks defaults to false)", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "NoLinks" })) as TaskId;
    const result = await service.get({ id });
    expect(result.task._links).toBeUndefined();
  });

  it("includes _links when includeLinks=true", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "Linked" })) as TaskId;
    const result = await service.get({ id, includeLinks: true });
    expect(result.task._links).toBeDefined();
    expect(result.task._links?.self).toBe(`omnifocus://task/${id}`);
  });

  it("explicit includeLinks=false also omits _links", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "ExplicitOff" })) as TaskId;
    const result = await service.get({ id, includeLinks: false });
    expect(result.task._links).toBeUndefined();
  });

  it("propagates includeLinks to subtask bodies", async () => {
    const { service, adapter } = makeHarness();
    const parentId = (await adapter.createTask({ name: "Parent" })) as TaskId;
    await adapter.createTask({ name: "Child", parentId });
    const result = await service.get({ id: parentId, includeSubtasks: true, includeLinks: true });
    expect(result.subtasks?.[0]?._links).toBeDefined();
  });

  it("subtasks omit _links by default", async () => {
    const { service, adapter } = makeHarness();
    const parentId = (await adapter.createTask({ name: "Parent" })) as TaskId;
    await adapter.createTask({ name: "Child", parentId });
    const result = await service.get({ id: parentId, includeSubtasks: true });
    expect(result.subtasks?.[0]?._links).toBeUndefined();
  });
});

describe("TaskService.get — error paths", () => {
  it("throws NotFound for an unknown task ID", async () => {
    const { service } = makeHarness();
    const unknownId = "task_unknown99" as TaskId;
    await expect(service.get({ id: unknownId })).rejects.toBeInstanceOf(NotFound);
  });

  it("NotFound message includes the ID for diagnostics", async () => {
    const { service } = makeHarness();
    const unknownId = "task_unknown99" as TaskId;
    const err = await service.get({ id: unknownId }).catch((e: unknown) => e);
    expect((err as NotFound).message).toMatch(/task_unknown99/);
  });
});

describe("TaskService.get — cache", () => {
  it("reports cacheHit=false on first call, cacheHit=true on repeat", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "Cached" })) as TaskId;
    const first = await service.get({ id });
    expect(first.cacheHit).toBe(false);
    const second = await service.get({ id });
    expect(second.cacheHit).toBe(true);
  });

  it("with-subtasks and solo calls use separate cache keys (no cross-talk)", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "T" })) as TaskId;
    await service.get({ id, includeSubtasks: true });
    // solo call should still be a miss (different cache slot)
    const solo = await service.get({ id, includeSubtasks: false });
    expect(solo.cacheHit).toBe(false);
  });

  it("repeat call does not re-query the adapter (short-circuit on hit)", async () => {
    const { service, adapter } = makeHarness();
    const id = (await adapter.createTask({ name: "T" })) as TaskId;
    const spy = vi.spyOn(adapter, "getTask");
    await service.get({ id });
    await service.get({ id });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
