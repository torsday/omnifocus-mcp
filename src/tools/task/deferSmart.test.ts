/**
 * Tests for `task_defer_smart` — wraps the dateGrammar resolver around the
 * task-update path. Covers: schema validation, intent resolution, dry-run
 * preview, idempotency replay, cache invalidation, and the after-event
 * gated-error variant.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { OmniFocusLruCache } from "../../cache/lruCache.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { CalendarBridgeUnavailable } from "../../errors/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskDeferSmart, taskDeferSmartInputSchema } from "./deferSmart.js";

const FRIDAY_AFTERNOON = new Date(2026, 3, 24, 15, 0, 0);

function assertOk<T>(envelope: ToolEnvelope<T>): ToolSuccess<T> {
  if (!("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope;
}

async function harness() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const taskId = await adapter.createTask({ name: "test" });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  const idempotencyStore = new IdempotencyStore();
  const ctx = {
    adapter,
    makeMeta,
    idempotencyStore,
    now: () => FRIDAY_AFTERNOON,
    hours: { morningHour: 9, afternoonHour: 14 },
  };
  return { ctx, adapter, taskId };
}

describe("task_defer_smart — input schema", () => {
  it("requires taskId and intent", () => {
    expect(() => taskDeferSmartInputSchema.parse({})).toThrow();
    expect(() => taskDeferSmartInputSchema.parse({ taskId: "x" })).toThrow();
  });

  it("accepts every intent kind", () => {
    const taskId = "task-12345";
    const inputs = [
      { taskId, intent: { kind: "next-work-day" } },
      { taskId, intent: { kind: "next-work-day", at: "afternoon" } },
      { taskId, intent: { kind: "next-weekday", weekday: 1 } },
      { taskId, intent: { kind: "in-business-days", days: 3 } },
      { taskId, intent: { kind: "after-event", eventId: "ev1" } },
      { taskId, intent: { kind: "next-month-start" } },
      { taskId, intent: { kind: "explicit-with-skip-weekends", date: "2026-04-25" } },
    ];
    for (const i of inputs) expect(() => taskDeferSmartInputSchema.parse(i)).not.toThrow();
  });

  it("rejects weekday out of 0..6", () => {
    expect(() =>
      taskDeferSmartInputSchema.parse({
        taskId: "task-12345",
        intent: { kind: "next-weekday", weekday: 7 },
      }),
    ).toThrow();
  });
});

describe("task_defer_smart — handler", () => {
  it("Friday afternoon + next-work-day → Monday at morning hour, applies to task", async () => {
    const { ctx, adapter, taskId } = await harness();
    const envelope = assertOk(
      await handleTaskDeferSmart({ taskId, intent: { kind: "next-work-day" } }, ctx),
    );
    expect(envelope.data.taskId).toBe(taskId);
    expect(envelope.data.resolvedDeferDate).toMatch(/^2026-04-27T09:00:00/);
    expect(envelope.data.reason).toContain("Mon");

    // The task should now have the resolved defer date.
    const task = await adapter.getTask(taskId);
    expect(task.deferDate).toMatch(/^2026-04-27T09:00:00/);
  });

  it("dry_run returns the resolution without writing", async () => {
    const { ctx, adapter, taskId } = await harness();
    const envelope = assertOk(
      await handleTaskDeferSmart({ taskId, intent: { kind: "next-work-day" }, dry_run: true }, ctx),
    );
    expect(envelope.meta.dryRun).toBe(true);
    expect(envelope.data.resolvedDeferDate).toMatch(/^2026-04-27T09:00:00/);

    const task = await adapter.getTask(taskId);
    expect(task.deferDate ?? null).toBeNull();
  });

  it("after-event variant throws CalendarBridgeUnavailable", async () => {
    const { ctx, taskId } = await harness();
    await expect(
      handleTaskDeferSmart({ taskId, intent: { kind: "after-event", eventId: "x" } }, ctx),
    ).rejects.toThrow(CalendarBridgeUnavailable);
  });

  it("idempotency_key replays the original envelope", async () => {
    const { ctx, taskId } = await harness();
    const args = {
      taskId,
      intent: { kind: "next-work-day" } as const,
      idempotency_key: "k1",
    };
    const first = assertOk(await handleTaskDeferSmart(args, ctx));
    const second = assertOk(await handleTaskDeferSmart(args, ctx));
    expect(second.data).toEqual(first.data);
    expect(second.meta.idempotentReplay).toBe(true);
  });

  it("cache invalidation runs on live path", async () => {
    const { ctx, adapter, taskId } = await harness();
    const cache = new OmniFocusLruCache();
    const seen: string[] = [];
    cache.on("cache.invalidated", (e: { scopes: Array<{ kind: string }> }) => {
      for (const s of e.scopes) seen.push(s.kind);
    });
    await handleTaskDeferSmart({ taskId, intent: { kind: "next-work-day" } }, { ...ctx, cache });
    expect(seen.length).toBeGreaterThan(0);
    void adapter; // keep noUnused happy
  });

  it("Friday + in-business-days(1) → Monday (skips weekend)", async () => {
    const { ctx, taskId } = await harness();
    const envelope = assertOk(
      await handleTaskDeferSmart({ taskId, intent: { kind: "in-business-days", days: 1 } }, ctx),
    );
    expect(envelope.data.resolvedDeferDate).toMatch(/^2026-04-27T/);
  });
});
