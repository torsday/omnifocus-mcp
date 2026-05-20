/**
 * Tests for `decision_record` and `decision_clear`.
 *
 * Covers: schema validation, task and project paths, idempotent clear,
 * note-preservation when sibling fences exist, and recordedAt injection.
 */

import { describe, expect, it, vi } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import { parseDecision } from "../../domain/decisionJournal.js";
import type { ResponseMeta, ToolEnvelope, ToolSuccess } from "../../envelope/index.js";
import { IdempotencyStore } from "../../server/idempotencyStore.js";
import { decisionClearInputSchema, handleDecisionClear } from "./clear.js";
import { decisionRecordInputSchema, handleDecisionRecord } from "./record.js";

const FIXED_NOW = new Date("2026-04-29T10:00:00Z");

function assertOk<T>(envelope: ToolEnvelope<T> | unknown): ToolSuccess<T> {
  if (envelope === null || typeof envelope !== "object" || !("data" in envelope)) {
    throw new Error(`expected success envelope, got error: ${JSON.stringify(envelope)}`);
  }
  return envelope as ToolSuccess<T>;
}

async function harness() {
  let tick = 0;
  const adapter = new InMemoryAdapter({
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  const taskId = await adapter.createTask({ name: "task" });
  const projectId = await adapter.createProject({ name: "project" });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-cid",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  });
  const ctx = { adapter, makeMeta, now: () => FIXED_NOW };
  return { ctx, adapter, taskId, projectId };
}

describe("decision_record — input schema", () => {
  it("requires targetKind, targetId, decision", () => {
    expect(() => decisionRecordInputSchema.parse({})).toThrow();
    expect(() => decisionRecordInputSchema.parse({ targetKind: "task" })).toThrow();
  });

  it("rejects an unknown decision kind", () => {
    expect(() =>
      decisionRecordInputSchema.parse({
        targetKind: "task",
        targetId: "abc",
        decision: { kind: "unknown-kind", reason: "x" },
      }),
    ).toThrow();
  });

  it("accepts every documented kind", () => {
    const kinds = [
      "stall-is-intentional",
      "deferred-by-choice",
      "blocked-on-external",
      "awaiting-decision",
      "acknowledged-zombie",
    ];
    for (const kind of kinds) {
      expect(() =>
        decisionRecordInputSchema.parse({
          targetKind: "task",
          targetId: "abc",
          decision: { kind, reason: "x" },
        }),
      ).not.toThrow();
    }
  });

  it("accepts an optional `until` (ISO-8601 with offset)", () => {
    expect(() =>
      decisionRecordInputSchema.parse({
        targetKind: "project",
        targetId: "abc",
        decision: { kind: "deferred-by-choice", reason: "x", until: "2026-05-15T10:00:00Z" },
      }),
    ).not.toThrow();
  });
});

describe("decision_record — handler (task target)", () => {
  it("writes a decision-journal fence into the task note", async () => {
    const { ctx, adapter, taskId } = await harness();
    const envelope = assertOk(
      await handleDecisionRecord(
        {
          targetKind: "task",
          targetId: taskId,
          decision: { kind: "stall-is-intentional", reason: "Intentional pause" },
        },
        ctx,
      ),
    );
    expect(envelope.data).toMatchObject({
      targetKind: "task",
      targetId: taskId,
      decision: {
        kind: "stall-is-intentional",
        reason: "Intentional pause",
        recordedAt: FIXED_NOW.toISOString(),
      },
    });

    const task = await adapter.getTask(taskId);
    const parsed = parseDecision(task.note);
    expect(parsed?.kind).toBe("stall-is-intentional");
  });

  it("preserves a sibling waiting-on fence when writing decision", async () => {
    const { ctx, adapter, taskId } = await harness();
    await adapter.updateTask(taskId, {
      note: "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00Z\n```\n\nfree text",
    });
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "x" },
      },
      ctx,
    );
    const task = await adapter.getTask(taskId);
    expect(task.note).toContain("```waiting-on");
    expect(task.note).toContain("```decision-journal");
    expect(task.note).toContain("free text");
  });
});

describe("decision_record — handler (project target)", () => {
  it("writes a decision-journal fence into the project note", async () => {
    const { ctx, adapter, projectId } = await harness();
    await handleDecisionRecord(
      {
        targetKind: "project",
        targetId: projectId,
        decision: {
          kind: "deferred-by-choice",
          reason: "Wait for budget",
          until: "2026-05-15T10:00:00Z",
        },
      },
      ctx,
    );
    const project = await adapter.getProject(projectId);
    const parsed = parseDecision(project.note);
    expect(parsed?.kind).toBe("deferred-by-choice");
    expect(parsed?.until).toBe("2026-05-15T10:00:00Z");
  });
});

describe("decision_clear — handler", () => {
  it("returns noChange:true when no fence is present (task)", async () => {
    const { ctx, taskId } = await harness();
    const envelope = assertOk(
      await handleDecisionClear({ targetKind: "task", targetId: taskId }, ctx),
    );
    expect(envelope.data).toMatchObject({ noChange: true });
  });

  it("returns noChange:true when no fence is present (project)", async () => {
    const { ctx, projectId } = await harness();
    const envelope = assertOk(
      await handleDecisionClear({ targetKind: "project", targetId: projectId }, ctx),
    );
    expect(envelope.data).toMatchObject({ noChange: true });
  });

  it("strips the fence and reports cleared:true (task)", async () => {
    const { ctx, adapter, taskId } = await harness();
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "x" },
      },
      ctx,
    );
    const envelope = assertOk(
      await handleDecisionClear({ targetKind: "task", targetId: taskId }, ctx),
    );
    expect(envelope.data).toMatchObject({ cleared: true });
    const task = await adapter.getTask(taskId);
    expect(parseDecision(task.note)).toBeUndefined();
  });

  it("preserves sibling waiting-on fence when clearing decision", async () => {
    const { ctx, adapter, taskId } = await harness();
    await adapter.updateTask(taskId, {
      note: "```waiting-on\nwhom: Alice\nsince: 2026-04-27T10:00:00Z\n```\n\nfree text",
    });
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "x" },
      },
      ctx,
    );
    await handleDecisionClear({ targetKind: "task", targetId: taskId }, ctx);
    const task = await adapter.getTask(taskId);
    expect(task.note).toContain("```waiting-on");
    expect(task.note).not.toContain("```decision-journal");
    expect(task.note).toContain("free text");
  });
});

describe("decision_clear — input schema", () => {
  it("requires targetKind and targetId", () => {
    expect(() => decisionClearInputSchema.parse({})).toThrow();
  });

  it("rejects an unknown targetKind", () => {
    expect(() =>
      decisionClearInputSchema.parse({ targetKind: "folder", targetId: "abc" }),
    ).toThrow();
  });
});

describe("decision_record — recordedAt injection", () => {
  it("uses ctx.now() to set recordedAt", async () => {
    const { ctx, adapter, taskId } = await harness();
    const customNow = new Date("2027-12-31T23:59:59Z");
    const customCtx = { ...ctx, now: vi.fn().mockReturnValue(customNow) };
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "x" },
      },
      customCtx,
    );
    const task = await adapter.getTask(taskId);
    const parsed = parseDecision(task.note);
    expect(parsed?.recordedAt).toBe(customNow.toISOString());
  });
});

// ---------------------------------------------------------------------------
// decision_record — idempotency_key (#981)
// ---------------------------------------------------------------------------

describe("decision_record — idempotency_key", () => {
  it("accepts an idempotency_key field on the input schema", () => {
    const parsed = decisionRecordInputSchema.parse({
      targetKind: "task",
      targetId: "task_001",
      decision: { kind: "stall-is-intentional", reason: "x" },
      idempotency_key: "k-1",
    });
    expect(parsed.idempotency_key).toBe("k-1");
  });

  it("rejects an empty idempotency_key", () => {
    expect(() =>
      decisionRecordInputSchema.parse({
        targetKind: "task",
        targetId: "task_001",
        decision: { kind: "stall-is-intentional", reason: "x" },
        idempotency_key: "",
      }),
    ).toThrow();
  });

  it("rejects an idempotency_key > 128 chars", () => {
    expect(() =>
      decisionRecordInputSchema.parse({
        targetKind: "task",
        targetId: "task_001",
        decision: { kind: "stall-is-intentional", reason: "x" },
        idempotency_key: "x".repeat(129),
      }),
    ).toThrow();
  });

  it("replays the original envelope on retry with the same key", async () => {
    const { ctx, adapter, taskId } = await harness();
    const idempotencyStore = new IdempotencyStore();
    const idCtx = { ...ctx, idempotencyStore };

    const first = await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "first reason" },
        idempotency_key: "k-1",
      },
      idCtx,
    );
    expect(first.data.decision.reason).toBe("first reason");
    expect(first.meta.idempotentReplay).toBeUndefined();

    // Second call with the same key — even with a *different* reason —
    // replays the first envelope. The decision-journal is NOT re-appended.
    const second = await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "second reason — should not apply" },
        idempotency_key: "k-1",
      },
      idCtx,
    );
    expect(second.data.decision.reason).toBe("first reason");
    expect(second.meta.idempotentReplay).toBe(true);

    // Adapter saw only the first write — the persisted decision is the
    // first one, NOT the would-be second.
    const task = await adapter.getTask(taskId);
    expect(parseDecision(task.note)?.reason).toBe("first reason");
  });

  it("different keys are independent (each one records its own decision)", async () => {
    const { ctx, adapter, taskId } = await harness();
    const idempotencyStore = new IdempotencyStore();
    const idCtx = { ...ctx, idempotencyStore };
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "a" },
        idempotency_key: "key-a",
      },
      idCtx,
    );
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "b" },
        idempotency_key: "key-b",
      },
      idCtx,
    );
    // Different keys, two independent writes — second decision overwrites
    // the first journal entry (the decisionJournal contract — only one
    // active decision per target).
    const task = await adapter.getTask(taskId);
    expect(parseDecision(task.note)?.reason).toBe("b");
  });

  it("no key ⇒ no caching: second call records again", async () => {
    const { ctx, adapter, taskId } = await harness();
    const idempotencyStore = new IdempotencyStore();
    const idCtx = { ...ctx, idempotencyStore };
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "first" },
      },
      idCtx,
    );
    await handleDecisionRecord(
      {
        targetKind: "task",
        targetId: taskId,
        decision: { kind: "stall-is-intentional", reason: "second" },
      },
      idCtx,
    );
    const task = await adapter.getTask(taskId);
    expect(parseDecision(task.note)?.reason).toBe("second");
  });
});
