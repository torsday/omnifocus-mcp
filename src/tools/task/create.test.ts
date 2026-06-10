/**
 * Tests for task_create tool.
 *
 * Covers: schema validation, inbox task creation, project task creation,
 * mutual-exclusion refine, syncPending meta, description content, and
 * idempotency-key replay (#250).
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskCreate, TASK_CREATE_DESCRIPTION, taskCreateInputSchema } from "./create.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

/** Narrow a handler envelope to ToolSuccess or fail the assertion. */
function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeCtx() {
  const adapter = new InMemoryAdapter();
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  const idempotencyStore = new IdempotencyStore();
  return { adapter, ctx: { adapter, makeMeta, idempotencyStore }, idempotencyStore };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("task_create — input schema", () => {
  it("accepts minimal inbox task", () => {
    expect(taskCreateInputSchema.safeParse({ name: "Test" }).success).toBe(true);
  });

  it("accepts project task with optional fields", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      projectId: "proj-abc123",
      flagged: true,
      dueDate: "2025-01-01T00:00:00+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = taskCreateInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects both projectId and parentTaskId", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      projectId: "proj-abc123",
      parentTaskId: "task-abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects dueDate earlier than deferDate", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      deferDate: "2025-06-01T00:00:00+00:00",
      dueDate: "2025-05-01T00:00:00+00:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("dueDate");
    }
  });

  it("accepts dueDate equal to deferDate", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      deferDate: "2025-06-01T00:00:00+00:00",
      dueDate: "2025-06-01T00:00:00+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts dueDate after deferDate", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      deferDate: "2025-05-01T00:00:00+00:00",
      dueDate: "2025-06-01T00:00:00+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts dueDate with no deferDate", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      dueDate: "2025-05-01T00:00:00+00:00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts idempotency_key", () => {
    const result = taskCreateInputSchema.safeParse({ name: "Test", idempotency_key: "abc" });
    expect(result.success).toBe(true);
  });

  it("rejects empty idempotency_key", () => {
    const result = taskCreateInputSchema.safeParse({ name: "Test", idempotency_key: "" });
    expect(result.success).toBe(false);
  });

  it("rejects idempotency_key longer than 128 chars", () => {
    const result = taskCreateInputSchema.safeParse({
      name: "Test",
      idempotency_key: "x".repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe("task_create — handler", () => {
  it("creates an inbox task and returns an id", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleTaskCreate({ name: "Inbox task" }, ctx));
    expect(typeof envelope.data.id).toBe("string");
    expect(envelope.data.id.length).toBeGreaterThan(0);
  });

  it("creates a project task", async () => {
    const { adapter, ctx } = makeCtx();
    const pid = await adapter.createProject({ name: "TestProject" });
    const envelope = assertOk(
      await handleTaskCreate({ name: "Project task", projectId: pid }, ctx),
    );
    expect(typeof envelope.data.id).toBe("string");
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleTaskCreate({ name: "Task" }, ctx));
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("pairs name with id in the response (#590)", async () => {
    const { ctx } = makeCtx();
    const envelope = assertOk(await handleTaskCreate({ name: "New thing" }, ctx));
    expect(envelope.data).toMatchObject({ name: "New thing" });
    expect(typeof envelope.data.id).toBe("string");
  });

  it("surfaces refinement failure with structured failures[] payload", async () => {
    // The MCP SDK validates only `taskCreateInputBaseSchema.shape`, so the
    // XOR refinement on the exported schema doesn't fire automatically.
    // The handler re-parses against the refined schema and surfaces an
    // actionable `details.failures` array — the lever-5 win from #575.
    const { ctx } = makeCtx();
    let caught: unknown;
    try {
      // Cast: the type rejects this combo, but the agent can still send it
      // — we want to verify the runtime guard fires.
      await handleTaskCreate(
        { name: "T", projectId: "proj_001", parentTaskId: "task_001" } as never,
        ctx,
      );
    } catch (e) {
      caught = e;
    }
    const { ValidationError } = await import("../../errors/index.js");
    expect(caught).toBeInstanceOf(ValidationError);
    if (!(caught instanceof ValidationError)) return;
    const failures = (caught.details as { failures: Array<{ field: string }> } | undefined)
      ?.failures;
    expect(Array.isArray(failures)).toBe(true);
    expect(failures?.length).toBeGreaterThan(0);
    expect(failures?.[0]?.field).toBe("projectId");
  });
});

// ---------------------------------------------------------------------------
// Idempotency (#250)
// ---------------------------------------------------------------------------

describe("task_create — idempotency_key", () => {
  it("creates once when called without a key", async () => {
    const { adapter, ctx } = makeCtx();
    await handleTaskCreate({ name: "A" }, ctx);
    await handleTaskCreate({ name: "A" }, ctx);
    const tasks = await adapter.listTasks({});
    expect(tasks.length).toBe(2);
  });

  it("replays the cached envelope on repeat with same key", async () => {
    const { adapter, ctx } = makeCtx();
    const first = assertOk(await handleTaskCreate({ name: "A", idempotency_key: "k1" }, ctx));
    const second = assertOk(await handleTaskCreate({ name: "A", idempotency_key: "k1" }, ctx));
    expect(second.data.id).toBe(first.data.id);
    expect(second.meta.idempotentReplay).toBe(true);
    const tasks = await adapter.listTasks({});
    expect(tasks.length).toBe(1);
  });

  it("treats different keys as separate creates", async () => {
    const { adapter, ctx } = makeCtx();
    const first = assertOk(await handleTaskCreate({ name: "A", idempotency_key: "k1" }, ctx));
    const second = assertOk(await handleTaskCreate({ name: "A", idempotency_key: "k2" }, ctx));
    expect(second.data.id).not.toBe(first.data.id);
    const tasks = await adapter.listTasks({});
    expect(tasks.length).toBe(2);
  });

  it("coalesces concurrent calls with the same key onto one adapter create", async () => {
    const { adapter, ctx } = makeCtx();
    const [a, b] = await Promise.all([
      handleTaskCreate({ name: "A", idempotency_key: "race" }, ctx),
      handleTaskCreate({ name: "A", idempotency_key: "race" }, ctx),
    ]);
    expect(assertOk(a).data.id).toBe(assertOk(b).data.id);
    const tasks = await adapter.listTasks({});
    expect(tasks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

describe("task_create — description", () => {
  it("mentions inbox", () => {
    expect(TASK_CREATE_DESCRIPTION).toContain("inbox");
  });

  it("mentions sync_trigger", () => {
    expect(TASK_CREATE_DESCRIPTION).toContain("sync_trigger");
  });

  it("mentions idempotency_key", () => {
    expect(TASK_CREATE_DESCRIPTION).toContain("idempotency_key");
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (docs/cache-invalidation.md)
// ---------------------------------------------------------------------------

describe("task_create — cache invalidation", () => {
  it("emits the parent task scope when creating a subtask", async () => {
    const { adapter, ctx } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const parentTaskId = await adapter.createTask({ name: "Parent" });

    await handleTaskCreate({ name: "Child", parentTaskId }, { ...ctx, cache });

    expect(scopes).toEqual([`task:${parentTaskId}`, "forecast:*", "perspective:*", "search:*"]);
  });

  it("emits only the wildcard scopes for an inbox task", async () => {
    const { ctx } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);

    await handleTaskCreate({ name: "Inbox task" }, { ...ctx, cache });

    expect(scopes).toEqual(["forecast:*", "perspective:*", "search:*"]);
  });
});
