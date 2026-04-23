/**
 * Tests for task_set_repetition and task_clear_repetition tools.
 *
 * Covers: schema validation, setting a rule, clearing a rule, invalid-rule
 * rejection, and unknown-ID surfacing.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { handleTaskClearRepetition, taskClearRepetitionInputSchema } from "./clearRepetition.js";
import { handleTaskSetRepetition, taskSetRepetitionInputSchema } from "./setRepetition.js";

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
// Schema — task_set_repetition
// ---------------------------------------------------------------------------

describe("task_set_repetition — input schema", () => {
  it("requires id and rule", () => {
    expect(() => taskSetRepetitionInputSchema.parse({})).toThrow();
    expect(() => taskSetRepetitionInputSchema.parse({ id: "task_000001" })).toThrow();
  });

  it("accepts a minimal daily rule", () => {
    const parsed = taskSetRepetitionInputSchema.parse({
      id: "task_000001",
      rule: { method: "fixed", unit: "days", steps: 1 },
    });
    expect(parsed.rule.unit).toBe("days");
  });

  it("accepts a weekly rule with weekdays", () => {
    const parsed = taskSetRepetitionInputSchema.parse({
      id: "task_000001",
      rule: { method: "start-again", unit: "weeks", steps: 1, weekdays: ["monday", "friday"] },
    });
    expect(parsed.rule.weekdays).toEqual(["monday", "friday"]);
  });

  it("rejects weekdays on non-week unit", () => {
    expect(() =>
      taskSetRepetitionInputSchema.parse({
        id: "task_000001",
        rule: { method: "fixed", unit: "days", steps: 1, weekdays: ["monday"] },
      }),
    ).toThrow();
  });

  it("rejects monthlyAnchor on non-month unit", () => {
    expect(() =>
      taskSetRepetitionInputSchema.parse({
        id: "task_000001",
        rule: { method: "fixed", unit: "weeks", steps: 1, monthlyAnchor: { day: 15 } },
      }),
    ).toThrow();
  });

  it("rejects steps below 1", () => {
    expect(() =>
      taskSetRepetitionInputSchema.parse({
        id: "task_000001",
        rule: { method: "fixed", unit: "days", steps: 0 },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Schema — task_clear_repetition
// ---------------------------------------------------------------------------

describe("task_clear_repetition — input schema", () => {
  it("requires id", () => {
    expect(() => taskClearRepetitionInputSchema.parse({})).toThrow();
  });

  it("accepts id-only input", () => {
    const parsed = taskClearRepetitionInputSchema.parse({ id: "task_000001" });
    expect(parsed.id).toBe("task_000001");
  });
});

// ---------------------------------------------------------------------------
// Handler — task_set_repetition
// ---------------------------------------------------------------------------

describe("task_set_repetition — handler", () => {
  it("sets a daily fixed repetition rule on a task", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Daily task" });

    const envelope = await handleTaskSetRepetition(
      { id, rule: { method: "fixed", unit: "days", steps: 1 } },
      ctx,
    );

    expect(envelope.data.task.id).toBe(id);
    expect(envelope.data.task.repetition).toMatchObject({
      method: "fixed",
      unit: "days",
      steps: 1,
    });

    // Returned entity matches a subsequent getTask
    const fetched = await adapter.getTask(id);
    expect(fetched.repetition).toMatchObject(envelope.data.task.repetition ?? {});
  });

  it("sets a weekly due-again rule with weekdays", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Weekly task" });

    await handleTaskSetRepetition(
      {
        id,
        rule: { method: "due-again", unit: "weeks", steps: 2, weekdays: ["tuesday", "thursday"] },
      },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(task.repetition?.weekdays).toEqual(["tuesday", "thursday"]);
    expect(task.repetition?.steps).toBe(2);
  });

  it("overwrites an existing rule", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Repeating task" });

    await handleTaskSetRepetition({ id, rule: { method: "fixed", unit: "days", steps: 1 } }, ctx);
    await handleTaskSetRepetition(
      { id, rule: { method: "start-again", unit: "weeks", steps: 1 } },
      ctx,
    );

    const task = await adapter.getTask(id);
    expect(task.repetition?.method).toBe("start-again");
    expect(task.repetition?.unit).toBe("weeks");
  });

  it("surfaces NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskSetRepetition(
        {
          id: "task_999999" as import("../../domain/ids.js").TaskId,
          rule: { method: "fixed", unit: "days", steps: 1 },
        },
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("returns envelope with full task entity", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Task X" });
    const envelope = await handleTaskSetRepetition(
      { id, rule: { method: "fixed", unit: "months", steps: 1, monthlyAnchor: { day: 1 } } },
      ctx,
    );
    expect(envelope.data.task.id).toBe(id);
    expect(envelope.meta.correlationId).toBe("test-cid");
  });
});

// ---------------------------------------------------------------------------
// Handler — task_clear_repetition
// ---------------------------------------------------------------------------

describe("task_clear_repetition — handler", () => {
  it("clears an existing repetition rule", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Repeating task" });

    await handleTaskSetRepetition({ id, rule: { method: "fixed", unit: "days", steps: 7 } }, ctx);
    // Confirm it's set
    const before = await adapter.getTask(id);
    expect(before.repetition).not.toBeNull();

    // Clear it
    await handleTaskClearRepetition({ id }, ctx);

    const after = await adapter.getTask(id);
    expect(after.repetition).toBeNull();
  });

  it("is idempotent — clearing a task with no rule is a no-op", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Non-repeating task" });

    const before = await adapter.getTask(id);
    expect(before.repetition).toBeNull();

    // Should not throw
    await handleTaskClearRepetition({ id }, ctx);

    const after = await adapter.getTask(id);
    expect(after.repetition).toBeNull();
  });

  it("surfaces NotFound for unknown task ID", async () => {
    const { ctx } = makeCtx();
    await expect(
      handleTaskClearRepetition({ id: "task_999999" as import("../../domain/ids.js").TaskId }, ctx),
    ).rejects.toThrow();
  });

  it("returns envelope with full task entity", async () => {
    const { ctx, adapter } = makeCtx();
    const id = await adapter.createTask({ name: "Task Y" });
    const envelope = await handleTaskClearRepetition({ id }, ctx);
    expect(envelope.data.task.id).toBe(id);
  });
});
