/**
 * Tests for `task_batch_defer_smart` — per-entry success/error rows;
 * one bad entry does not abort siblings.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { handleTaskBatchDeferSmart, taskBatchDeferSmartInputSchema } from "./batchDeferSmart.js";

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
  const t1 = await adapter.createTask({ name: "task 1" });
  const t2 = await adapter.createTask({ name: "task 2" });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  return {
    ctx: {
      adapter,
      makeMeta,
      idempotencyStore: new IdempotencyStore(),
      now: () => FRIDAY_AFTERNOON,
      hours: { morningHour: 9, afternoonHour: 14 },
    },
    adapter,
    t1,
    t2,
  };
}

describe("task_batch_defer_smart — schema", () => {
  it("requires non-empty entries array", () => {
    expect(() => taskBatchDeferSmartInputSchema.parse({ entries: [] })).toThrow();
  });
});

describe("task_batch_defer_smart — handler", () => {
  it("resolves both entries and applies to both tasks", async () => {
    const { ctx, adapter, t1, t2 } = await harness();
    const envelope = assertOk(
      await handleTaskBatchDeferSmart(
        {
          entries: [
            { taskId: t1, intent: { kind: "next-work-day" } },
            { taskId: t2, intent: { kind: "in-business-days", days: 3 } },
          ],
        },
        ctx,
      ),
    );
    expect(envelope.data.results).toHaveLength(2);
    expect(envelope.data.results[0]).toMatchObject({ taskId: t1, ok: true });
    expect(envelope.data.results[1]).toMatchObject({ taskId: t2, ok: true });
    const a = await adapter.getTask(t1);
    const b = await adapter.getTask(t2);
    expect(a.deferDate).toMatch(/^2026-04-27T/);
    expect(b.deferDate).toMatch(/^2026-04-29T/);
  });

  it("after-event variant fails one entry but does not abort siblings", async () => {
    const { ctx, t1, t2 } = await harness();
    const envelope = assertOk(
      await handleTaskBatchDeferSmart(
        {
          entries: [
            { taskId: t1, intent: { kind: "after-event", eventId: "e1" } },
            { taskId: t2, intent: { kind: "next-work-day" } },
          ],
        },
        ctx,
      ),
    );
    expect(envelope.data.results).toHaveLength(2);
    const first = envelope.data.results[0];
    const second = envelope.data.results[1];
    if (first === undefined || second === undefined) throw new Error("missing rows");
    expect(first.ok).toBe(false);
    if (first.ok === false) expect(first.error).toMatch(/calendar|after-event/i);
    expect(second.ok).toBe(true);
  });

  it("dry_run does not write any task", async () => {
    const { ctx, adapter, t1 } = await harness();
    await handleTaskBatchDeferSmart(
      {
        entries: [{ taskId: t1, intent: { kind: "next-work-day" } }],
        dry_run: true,
      },
      ctx,
    );
    const t = await adapter.getTask(t1);
    expect(t.deferDate ?? null).toBeNull();
  });
});
