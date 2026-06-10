/**
 * Tests for project_delete tool.
 *
 * Covers: schema validation, successful deletion, NotFound for unknown ID,
 * double-delete raises NotFound, cascade behavior (contained tasks are
 * disassociated from the project), response shape, and the three safety
 * primitives composed in `handleProjectDelete` (expectedModifiedAt, dry_run,
 * idempotency_key).
 *
 * NOTE: The InMemoryAdapter orphans contained tasks (sets projectId=null)
 * rather than hard-deleting them — this matches the observable outcome for
 * the project scope but differs from real OmniFocus which hard-deletes tasks.
 * Integration tests cover the JXA cascade behavior.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleProjectDelete, projectDeleteInputSchema } from "./delete.js";

/** Narrow a handler envelope to ToolSuccess or fail the assertion. */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
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
  const idempotencyStore = new IdempotencyStore();
  return { ctx: { adapter, makeMeta, idempotencyStore }, adapter, idempotencyStore };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("project_delete — input schema", () => {
  it("requires id", () => {
    expect(() => projectDeleteInputSchema.parse({})).toThrow();
  });

  it("accepts a valid project ID", () => {
    const parsed = projectDeleteInputSchema.parse({ id: "project_000001" });
    expect(parsed.id).toBe("project_000001");
  });

  it("accepts optional safety fields", () => {
    const parsed = projectDeleteInputSchema.parse({
      id: "project_000001",
      expectedModifiedAt: "2026-01-01T00:00:00Z",
      dry_run: true,
      idempotency_key: "k-1",
    });
    expect(parsed.expectedModifiedAt).toBe("2026-01-01T00:00:00Z");
    expect(parsed.dry_run).toBe(true);
    expect(parsed.idempotency_key).toBe("k-1");
  });

  it("rejects an empty idempotency_key", () => {
    expect(() =>
      projectDeleteInputSchema.parse({ id: "project_000001", idempotency_key: "" }),
    ).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      projectDeleteInputSchema.parse({ id: "project_000001", idempotency_key: "x".repeat(129) }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("project_delete — handler", () => {
  it("deletes an existing project and returns { deleted: true, id }", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "To delete" });

    const envelope = assertOk(await handleProjectDelete({ id }, ctx));

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true on deletion", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = assertOk(await handleProjectDelete({ id }, ctx));
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("removes the project from the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleProjectDelete({ id }, ctx);
    await expect(adapter.getProject(id)).rejects.toThrow();
  });

  it("throws NotFound for unknown project ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectDelete({ id: "project_999999" as import("../../domain/ids.js").ProjectId }, ctx),
    ).rejects.toThrow();
  });

  it("double-delete raises NotFound (not silent)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await handleProjectDelete({ id }, ctx);
    await expect(handleProjectDelete({ id }, ctx)).rejects.toThrow();
  });

  it("cascade: contained tasks are no longer associated with the deleted project", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "My Project" });
    const taskId = await adapter.createTask({ name: "Task in project", projectId });

    const before = await adapter.getTask(taskId);
    expect(before.projectId).toBe(projectId);

    await handleProjectDelete({ id: projectId }, ctx);

    await expect(adapter.getProject(projectId)).rejects.toThrow();

    const after = await adapter.getTask(taskId);
    expect(after.projectId).toBeNull();
  });

  it("deleting one project does not affect sibling projects", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createProject({ name: "A" });
    const idB = await adapter.createProject({ name: "B" });
    await handleProjectDelete({ id: idA }, ctx);
    const remaining = await adapter.listProjects({});
    expect(remaining.some((p) => p.id === idB)).toBe(true);
    expect(remaining.some((p) => p.id === idA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("project_delete — cache invalidation", () => {
  it("emits project:${id}, forecast:*, perspective:*, search:*, folder:list", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectDelete({ id }, { ...base, cache });

    expect(scopes).toEqual([
      `project:${id}`,
      "forecast:*",
      "perspective:*",
      "search:*",
      "folder:list",
    ]);
  });

  it("does not invalidate when the delete fails (NotFound)", async () => {
    const { ctx: base } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    await expect(
      handleProjectDelete(
        { id: "project_999999" as import("../../domain/ids.js").ProjectId },
        { ...base, cache },
      ),
    ).rejects.toThrow();
    expect(scopes).toEqual([]);
  });

  it("does not invalidate on a dry_run preview", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectDelete({ id, dry_run: true }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — expectedModifiedAt
// ---------------------------------------------------------------------------

describe("project_delete — expectedModifiedAt guard", () => {
  it("proceeds when expectedModifiedAt matches the current project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const project = await adapter.getProject(id);
    const envelope = assertOk(
      await handleProjectDelete({ id, expectedModifiedAt: project.modifiedAt }, ctx),
    );
    expect(envelope.data.deleted).toBe(true);
  });

  it("throws ConflictError (OF_CONFLICT) when expectedModifiedAt is stale", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectDelete({ id, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("does not delete the project when the guard trips", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectDelete({ id, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toThrow();
    const still = await adapter.getProject(id);
    expect(still.id).toBe(id);
  });

  it("raises ValidationError when expectedModifiedAt is malformed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectDelete({ id, expectedModifiedAt: "not-a-timestamp" }, ctx),
    ).rejects.toMatchObject({ code: "OF_VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — dry_run
// ---------------------------------------------------------------------------

describe("project_delete — dry_run", () => {
  it("returns a preview envelope without calling the adapter", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    const envelope = assertOk(await handleProjectDelete({ id, dry_run: true }, ctx));

    expect(envelope.data.deleted).toBe(true);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.dryRun).toBe(true);
    expect(envelope.meta.syncPending).toBe(false);

    const still = await adapter.getProject(id);
    expect(still.id).toBe(id);
  });

  it("dry_run still enforces expectedModifiedAt", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectDelete({ id, dry_run: true, expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("dry_run for a missing project still throws NotFound (pre-fetch path)", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectDelete(
        {
          id: "project_999999" as import("../../domain/ids.js").ProjectId,
          dry_run: true,
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("dry_run preserves contained tasks", async () => {
    const { ctx, adapter } = makeCtx();
    const projectId = await adapter.createProject({ name: "P" });
    const taskId = await adapter.createTask({ name: "T", projectId });

    await handleProjectDelete({ id: projectId, dry_run: true }, ctx);

    // Project still present; task still linked to it.
    const task = await adapter.getTask(taskId);
    expect(task.projectId).toBe(projectId);
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — idempotency_key
// ---------------------------------------------------------------------------

describe("project_delete — idempotency_key", () => {
  it("replays the original envelope on retry with the same key", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    const first = assertOk(await handleProjectDelete({ id, idempotency_key: "k-1" }, ctx));
    expect(first.data.deleted).toBe(true);
    expect(first.meta.idempotentReplay).toBeUndefined();

    const second = assertOk(await handleProjectDelete({ id, idempotency_key: "k-1" }, ctx));
    expect(second.data.deleted).toBe(true);
    expect(second.data.id).toBe(id);
    expect(second.meta.idempotentReplay).toBe(true);
  });

  it("different keys are independent", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createProject({ name: "A" });
    const idB = await adapter.createProject({ name: "B" });

    await handleProjectDelete({ id: idA, idempotency_key: "a" }, ctx);
    await handleProjectDelete({ id: idB, idempotency_key: "b" }, ctx);

    await expect(adapter.getProject(idA)).rejects.toThrow();
    await expect(adapter.getProject(idB)).rejects.toThrow();
  });

  it("no key ⇒ no caching: second call raises NotFound", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    await handleProjectDelete({ id }, ctx);
    await expect(handleProjectDelete({ id }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — composition
// ---------------------------------------------------------------------------

describe("project_delete — dry_run + idempotency_key composition", () => {
  it("a dry_run with a key replays the preview envelope, not a live delete", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    const first = assertOk(
      await handleProjectDelete({ id, dry_run: true, idempotency_key: "k-dry" }, ctx),
    );
    expect(first.meta.dryRun).toBe(true);
    expect(first.meta.syncPending).toBe(false);

    expect((await adapter.getProject(id)).id).toBe(id);

    // Same key with dry_run off: replay of the dry-run envelope wins.
    const second = assertOk(
      await handleProjectDelete({ id, dry_run: false, idempotency_key: "k-dry" }, ctx),
    );
    expect(second.meta.dryRun).toBe(true);
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getProject(id)).id).toBe(id);
  });
});
