/**
 * Tests for task_set_alarms and task_clear_alarms tools.
 *
 * Covers: schema validation, setting / clearing alarms, anchor pre-validation
 * for relative alarms, replace-not-merge semantics, and unknown-ID surfacing.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskClearAlarms, taskClearAlarmsInputSchema } from "./clearAlarms.js";
import { handleTaskSetAlarms, taskSetAlarmsInputSchema } from "./setAlarms.js";

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
// Schema — task_set_alarms
// ---------------------------------------------------------------------------

describe("task_set_alarms — input schema", () => {
  it("requires id and alarms", () => {
    expect(() => taskSetAlarmsInputSchema.parse({})).toThrow();
    expect(() => taskSetAlarmsInputSchema.parse({ id: "task_000001" })).toThrow();
  });

  it("accepts an empty alarm array (full-replace clear)", () => {
    const parsed = taskSetAlarmsInputSchema.parse({ id: "task_000001", alarms: [] });
    expect(parsed.alarms).toEqual([]);
  });

  it("accepts a due-relative alarm", () => {
    const parsed = taskSetAlarmsInputSchema.parse({
      id: "task_000001",
      alarms: [{ kind: "due-relative", offsetSeconds: 3600 }],
    });
    expect(parsed.alarms[0]).toMatchObject({ kind: "due-relative", offsetSeconds: 3600 });
  });

  it("accepts an absolute alarm with ISO fireAt", () => {
    const parsed = taskSetAlarmsInputSchema.parse({
      id: "task_000001",
      alarms: [{ kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" }],
    });
    expect(parsed.alarms[0]).toMatchObject({ kind: "absolute" });
  });

  it("rejects unknown alarm kind", () => {
    expect(() =>
      taskSetAlarmsInputSchema.parse({
        id: "task_000001",
        alarms: [{ kind: "bogus", offsetSeconds: 1 }],
      }),
    ).toThrow();
  });

  it("rejects non-integer offsetSeconds", () => {
    expect(() =>
      taskSetAlarmsInputSchema.parse({
        id: "task_000001",
        alarms: [{ kind: "due-relative", offsetSeconds: 1.5 }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema — task_clear_alarms
// ---------------------------------------------------------------------------

describe("task_clear_alarms — input schema", () => {
  it("requires id", () => {
    expect(() => taskClearAlarmsInputSchema.parse({})).toThrow();
  });

  it("accepts id-only input", () => {
    const parsed = taskClearAlarmsInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler — task_set_alarms
// ---------------------------------------------------------------------------

describe("task_set_alarms — handler", () => {
  it("sets an absolute alarm on a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Pay bills" });

    const envelope = await handleTaskSetAlarms(
      { id, alarms: [{ kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" }] },
      ctx,
    );

    expect(envelope.data.task.id).toBe(id);
    expect(envelope.data.task.notifications).toHaveLength(1);
    expect(envelope.data.task.notifications?.[0]).toMatchObject({
      kind: "absolute",
      fireAt: "2026-06-01T09:00:00.000Z",
    });

    const fetched = await adapter.getTask(id);
    expect(fetched.notifications).toHaveLength(1);
  });

  it("sets a due-relative alarm when the task has a dueDate", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({
      name: "Soon",
      dueDate: "2026-06-01T17:00:00.000Z",
    });

    const envelope = await handleTaskSetAlarms(
      { id, alarms: [{ kind: "due-relative", offsetSeconds: 3600 }] },
      ctx,
    );

    expect(envelope.data.task.notifications?.[0]).toMatchObject({
      kind: "due-relative",
      offsetSeconds: 3600,
    });
  });

  it("rejects a due-relative alarm when the task has no dueDate", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "No date" });

    await expect(
      handleTaskSetAlarms({ id, alarms: [{ kind: "due-relative", offsetSeconds: 3600 }] }, ctx),
    ).rejects.toThrow(/dueDate/);

    // And nothing was applied.
    const task = await adapter.getTask(id);
    expect(task.notifications).toBeUndefined();
  });

  it("rejects a defer-relative alarm when the task has no deferDate", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "No defer" });

    await expect(
      handleTaskSetAlarms({ id, alarms: [{ kind: "defer-relative", offsetSeconds: 60 }] }, ctx),
    ).rejects.toThrow(/deferDate/);
  });

  it("replaces (not merges) the prior alarm set", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Replace me" });

    await handleTaskSetAlarms(
      { id, alarms: [{ kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" }] },
      ctx,
    );
    await handleTaskSetAlarms(
      {
        id,
        alarms: [
          { kind: "absolute", fireAt: "2026-07-01T09:00:00.000Z" },
          { kind: "absolute", fireAt: "2026-08-01T09:00:00.000Z" },
        ],
      },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(task.notifications).toHaveLength(2);
    expect(task.notifications?.map((a) => (a.kind === "absolute" ? a.fireAt : null))).toEqual([
      "2026-07-01T09:00:00.000Z",
      "2026-08-01T09:00:00.000Z",
    ]);
  });

  it("clears alarms when called with an empty array", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Drop" });
    await handleTaskSetAlarms(
      { id, alarms: [{ kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" }] },
      ctx,
    );
    await handleTaskSetAlarms({ id, alarms: [] }, ctx);

    const task = await adapter.getTask(id);
    expect(task.notifications).toBeUndefined();
  });

  it("surfaces NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskSetAlarms(
        {
          id: "task_999999" as TaskId,
          alarms: [{ kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" }],
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler — task_clear_alarms
// ---------------------------------------------------------------------------

describe("task_clear_alarms — handler", () => {
  it("clears all alarms from a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Drop me" });
    await handleTaskSetAlarms(
      {
        id,
        alarms: [
          { kind: "absolute", fireAt: "2026-06-01T09:00:00.000Z" },
          { kind: "absolute", fireAt: "2026-07-01T09:00:00.000Z" },
        ],
      },
      ctx,
    );

    const envelope = await handleTaskClearAlarms({ id }, ctx);
    expect(envelope.data.task.notifications).toBeUndefined();

    const task = await adapter.getTask(id);
    expect(task.notifications).toBeUndefined();
  });

  it("is idempotent on a task with no alarms", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Empty" });
    const envelope = await handleTaskClearAlarms({ id }, ctx);
    expect(envelope.data.task.id).toBe(id);
  });

  it("surfaces NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(handleTaskClearAlarms({ id: "task_999999" as TaskId }, ctx)).rejects.toThrow();
  });
});
