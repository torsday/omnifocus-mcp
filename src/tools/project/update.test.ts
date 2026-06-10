/**
 * Tests for project_update tool.
 *
 * Covers: schema validation, successful update, nullable field clearing,
 * cache invalidation, and response shape.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleProjectUpdate, projectUpdateInputSchema } from "./update.js";

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

    const envelope = assertOk(await handleProjectUpdate({ id, name: "Updated" }, ctx));

    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const envelope = assertOk(await handleProjectUpdate({ id }, ctx));
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("pairs the post-patch name with id in the response (#585)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Before" });
    const envelope = assertOk(await handleProjectUpdate({ id, name: "After" }, ctx));
    expect(envelope.data).toMatchObject({ updated: true, id, name: "After" });
  });

  it("pairs the existing name with id when no name patch (#585)", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Stable" });
    const envelope = assertOk(await handleProjectUpdate({ id, flagged: true }, ctx));
    expect(envelope.data).toMatchObject({ updated: true, id, name: "Stable" });
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
  it("emits project:${id}, forecast:*, perspective:*, search:*, folder:list", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectUpdate({ id }, { ...base, cache });

    expect(scopes).toEqual([
      `project:${id}`,
      "forecast:*",
      "perspective:*",
      "search:*",
      "folder:list",
    ]);
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

  it("does not invalidate on a dry_run preview", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createProject({ name: "P" });

    await handleProjectUpdate({ id, name: "renamed", dry_run: true }, { ...base, cache });

    expect(scopes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schema — optional safety fields
// ---------------------------------------------------------------------------

describe("project_update — input schema: safety fields", () => {
  it("accepts optional safety fields", () => {
    const parsed = projectUpdateInputSchema.parse({
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
      projectUpdateInputSchema.parse({ id: "project_000001", idempotency_key: "" }),
    ).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      projectUpdateInputSchema.parse({
        id: "project_000001",
        idempotency_key: "x".repeat(129),
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — expectedModifiedAt
// ---------------------------------------------------------------------------

describe("project_update — expectedModifiedAt guard", () => {
  it("proceeds when expectedModifiedAt matches", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    const project = await adapter.getProject(id);
    const envelope = assertOk(
      await handleProjectUpdate(
        { id, name: "Renamed", expectedModifiedAt: project.modifiedAt },
        ctx,
      ),
    );
    expect(envelope.data.updated).toBe(true);
    expect((await adapter.getProject(id)).name).toBe("Renamed");
  });

  it("throws ConflictError (OF_CONFLICT) when expectedModifiedAt is stale", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectUpdate({ id, name: "Renamed", expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("does not patch the project when the guard trips", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Original" });
    await expect(
      handleProjectUpdate({ id, name: "Renamed", expectedModifiedAt: "2020-01-01T00:00:00Z" }, ctx),
    ).rejects.toThrow();
    expect((await adapter.getProject(id)).name).toBe("Original");
  });

  it("raises ValidationError on malformed expectedModifiedAt", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectUpdate({ id, name: "X", expectedModifiedAt: "not-a-timestamp" }, ctx),
    ).rejects.toMatchObject({ code: "OF_VALIDATION" });
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — dry_run
// ---------------------------------------------------------------------------

describe("project_update — dry_run", () => {
  it("returns a preview envelope without mutating the project", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Original", flagged: false });

    const envelope = assertOk(
      await handleProjectUpdate({ id, name: "Renamed", flagged: true, dry_run: true }, ctx),
    );

    expect(envelope.data.updated).toBe(true);
    expect(envelope.data.id).toBe(id);
    expect(envelope.meta.dryRun).toBe(true);
    expect(envelope.meta.syncPending).toBe(false);

    const still = await adapter.getProject(id);
    expect(still.name).toBe("Original");
    expect(still.flagged).toBe(false);
  });

  it("dry_run still enforces expectedModifiedAt", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });
    await expect(
      handleProjectUpdate(
        { id, name: "X", dry_run: true, expectedModifiedAt: "2020-01-01T00:00:00Z" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "OF_CONFLICT" });
  });

  it("dry_run for a missing project still throws NotFound (pre-fetch path)", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleProjectUpdate(
        {
          id: "project_999999" as import("../../domain/ids.js").ProjectId,
          name: "X",
          dry_run: true,
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — idempotency_key
// ---------------------------------------------------------------------------

describe("project_update — idempotency_key", () => {
  it("replays the original envelope on retry with the same key", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Original" });

    const first = assertOk(
      await handleProjectUpdate({ id, name: "Renamed", idempotency_key: "k-1" }, ctx),
    );
    expect(first.data.updated).toBe(true);
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Second call with the same key — different patch, but the replay wins.
    const second = assertOk(
      await handleProjectUpdate({ id, name: "Different", idempotency_key: "k-1" }, ctx),
    );
    expect(second.meta.idempotentReplay).toBe(true);

    // Adapter saw only the first write.
    expect((await adapter.getProject(id)).name).toBe("Renamed");
  });

  it("different keys are independent", async () => {
    const { ctx, adapter } = makeCtx();
    const idA = await adapter.createProject({ name: "A" });
    const idB = await adapter.createProject({ name: "B" });

    await handleProjectUpdate({ id: idA, name: "A2", idempotency_key: "a" }, ctx);
    await handleProjectUpdate({ id: idB, name: "B2", idempotency_key: "b" }, ctx);

    expect((await adapter.getProject(idA)).name).toBe("A2");
    expect((await adapter.getProject(idB)).name).toBe("B2");
  });

  it("no key ⇒ no caching: second call re-applies the patch", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "P" });

    await handleProjectUpdate({ id, name: "First" }, ctx);
    await handleProjectUpdate({ id, name: "Second" }, ctx);

    expect((await adapter.getProject(id)).name).toBe("Second");
  });
});

// ---------------------------------------------------------------------------
// Safety primitives — composition
// ---------------------------------------------------------------------------

describe("project_update — dry_run + idempotency_key composition", () => {
  it("a dry_run with a key replays the preview envelope, not a live update", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createProject({ name: "Original" });

    const first = assertOk(
      await handleProjectUpdate(
        { id, name: "Preview", dry_run: true, idempotency_key: "k-dry" },
        ctx,
      ),
    );
    expect(first.meta.dryRun).toBe(true);
    expect(first.meta.syncPending).toBe(false);
    expect((await adapter.getProject(id)).name).toBe("Original");

    // Second call with same key: replay of dry-run envelope even if dry_run flips off.
    const second = assertOk(
      await handleProjectUpdate(
        { id, name: "LiveAttempt", dry_run: false, idempotency_key: "k-dry" },
        ctx,
      ),
    );
    expect(second.meta.dryRun).toBe(true);
    expect(second.meta.idempotentReplay).toBe(true);
    expect((await adapter.getProject(id)).name).toBe("Original");
  });
});
