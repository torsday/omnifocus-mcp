/**
 * Tests for `task_set_waiting_on` and `task_clear_waiting_on`.
 *
 * Covers: schema validation, tag create-if-absent, fence round-trip with
 * existing user prose, idempotent clear, cache invalidation, and noChange.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { type InvalidationScope, OmniFocusLruCache } from "../../cache/lruCache.js";
import { parseWaitingOn } from "../../domain/waitingOn.js";
import type { ResponseMeta } from "../../envelope/index.js";
import {
  handleTaskClearWaitingOn,
  handleTaskSetWaitingOn,
  taskClearWaitingOnInputSchema,
  taskSetWaitingOnInputSchema,
} from "./waitingOn.js";

function recordScopes(cache: OmniFocusLruCache): InvalidationScope[] {
  const scopes: InvalidationScope[] = [];
  cache.on("cache.invalidated", (e: { scopes: InvalidationScope[] }) => {
    scopes.push(...e.scopes);
  });
  return scopes;
}

function makeCtx(waitingTagName = "waiting") {
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
  return { adapter, ctx: { adapter, makeMeta, waitingTagName } };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe("task_set_waiting_on — input schema", () => {
  it("requires taskId and whom", () => {
    expect(() => taskSetWaitingOnInputSchema.parse({})).toThrow();
    expect(() => taskSetWaitingOnInputSchema.parse({ taskId: "task_001" })).toThrow();
  });

  it("accepts taskId + whom only", () => {
    const parsed = taskSetWaitingOnInputSchema.parse({
      taskId: "task_001",
      whom: "Alice",
    });
    expect(parsed.whom).toBe("Alice");
  });

  it("rejects ISO dates without offset", () => {
    expect(() =>
      taskSetWaitingOnInputSchema.parse({
        taskId: "task_001",
        whom: "Alice",
        since: "2026-04-27T10:00:00",
      }),
    ).toThrow();
  });
});

describe("task_clear_waiting_on — input schema", () => {
  it("requires taskId", () => {
    expect(() => taskClearWaitingOnInputSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// task_set_waiting_on handler
// ---------------------------------------------------------------------------

describe("task_set_waiting_on — handler", () => {
  it("creates the @waiting tag when absent and tags the task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );

    const tags = await adapter.listTags();
    expect(tags.map((t) => t.name)).toContain("waiting");
    const task = await adapter.getTask(id);
    const waitingTagId = tags.find((t) => t.name === "waiting")?.id;
    expect(waitingTagId).toBeDefined();
    expect(task.tagIds).toContain(waitingTagId);
  });

  it("reuses an existing tag with case-insensitive match", async () => {
    const { ctx, adapter } = makeCtx();
    const existingTagId = await adapter.createTag({ name: "Waiting" });
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );

    const allTags = await adapter.listTags();
    expect(allTags.filter((t) => t.name.toLowerCase() === "waiting")).toHaveLength(1);
    const task = await adapter.getTask(id);
    expect(task.tagIds).toContain(existingTagId);
  });

  it("respects a custom waiting tag name", async () => {
    const { ctx, adapter } = makeCtx("WaitingOnSomeone");
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );

    const tags = await adapter.listTags();
    expect(tags.map((t) => t.name)).toContain("WaitingOnSomeone");
  });

  it("writes a fenced block to the note that round-trips through parseWaitingOn", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      {
        taskId: id,
        whom: "Alice",
        what: "contract review",
        since: "2026-04-27T10:00:00-05:00",
        followUpAfter: "2026-05-02T00:00:00-05:00",
      },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(parseWaitingOn(task.note)).toEqual({
      whom: "Alice",
      what: "contract review",
      since: "2026-04-27T10:00:00-05:00",
      followUpAfter: "2026-05-02T00:00:00-05:00",
    });
  });

  it("preserves existing user prose when prepending the fence", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "user wrote this earlier" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(task.note).toContain("user wrote this earlier");
    expect(task.note).toContain("```waiting-on");
  });

  it("replaces an existing fence rather than duplicating", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );
    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Bob", since: "2026-04-28T09:00:00-05:00" },
      ctx,
    );

    const task = await adapter.getTask(id);
    const fenceCount = (task.note ?? "").split("```waiting-on").length - 1;
    expect(fenceCount).toBe(1);
    expect(parseWaitingOn(task.note)?.whom).toBe("Bob");
  });

  it("defaults `since` to the current time when omitted", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const before = new Date();
    const envelope = await handleTaskSetWaitingOn({ taskId: id, whom: "Alice" }, ctx);
    const after = new Date();

    const since = new Date(envelope.data.waitingOn.since);
    expect(since.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(since.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it("sets meta.syncPending = true", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const envelope = await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );
    expect(envelope.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// task_clear_waiting_on handler
// ---------------------------------------------------------------------------

describe("task_clear_waiting_on — handler", () => {
  it("returns noChange when the task has no fence and no @waiting tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    const envelope = await handleTaskClearWaitingOn({ taskId: id }, ctx);
    expect("noChange" in envelope.data && envelope.data.noChange).toBe(true);
    expect(envelope.meta.syncPending).toBeFalsy();
  });

  it("strips the fence and removes the @waiting tag", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T", note: "user prose" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );
    await handleTaskClearWaitingOn({ taskId: id }, ctx);

    const task = await adapter.getTask(id);
    expect(parseWaitingOn(task.note)).toBeUndefined();
    expect(task.note).toBe("user prose");
    const tags = await adapter.listTags();
    const waitingTagId = tags.find((t) => t.name === "waiting")?.id;
    expect(waitingTagId).toBeDefined();
    expect(task.tagIds).not.toContain(waitingTagId);
  });

  it("returns cleared:true with syncPending when something changed", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });
    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      ctx,
    );

    const envelope = await handleTaskClearWaitingOn({ taskId: id }, ctx);
    expect("cleared" in envelope.data && envelope.data.cleared).toBe(true);
    expect(envelope.meta.syncPending).toBe(true);
  });

  it("does not create the tag as a side effect when no fence is present", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "T" });

    await handleTaskClearWaitingOn({ taskId: id }, ctx);

    const tags = await adapter.listTags();
    expect(tags.map((t) => t.name)).not.toContain("waiting");
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("task_set_waiting_on — cache invalidation", () => {
  it("emits task:${id} and global scopes after a write", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });

    await handleTaskSetWaitingOn(
      { taskId: id, whom: "Alice", since: "2026-04-27T10:00:00-05:00" },
      { ...base, cache },
    );

    expect(scopes).toContain(`task:${id}`);
  });

  it("does not invalidate on noChange clear", async () => {
    const { ctx: base, adapter } = makeCtx();
    const cache = new OmniFocusLruCache();
    const scopes = recordScopes(cache);
    const id = await adapter.createTask({ name: "T" });

    await handleTaskClearWaitingOn({ taskId: id }, { ...base, cache });
    expect(scopes).toEqual([]);
  });
});
