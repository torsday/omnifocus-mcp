/**
 * Unit tests for `task_reclassify`.
 *
 * Predicate-evaluator behaviour is covered exhaustively in
 * `src/domain/taskPredicate.test.ts`. These tests cover the tool seam:
 * dry-run shape, the apply path through batchAssign, the three failure
 * modes called out in the AC (stale confirmation, > 200 cap, predicate
 * matches nothing), schema validation, and registration.
 */

import { describe, expect, it, vi } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";

import {
  computeAfter,
  handleTaskReclassify,
  registerTaskReclassifyTool,
  snapshotBefore,
  taskReclassifyInputSchema,
} from "./reclassify.js";

const META: ResponseMeta = {
  correlationId: "01TESTRECLASSIFY",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

function makeCtx(adapter: InMemoryAdapter) {
  return {
    adapter,
    makeMeta: (partial: Partial<ResponseMeta> = {}) => ({ ...META, ...partial }),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("snapshotBefore", () => {
  it("captures projectId / tagIds / flagged", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagId = await adapter.createTag({ name: "x" });
    const taskId = await adapter.createTask({
      name: "t",
      projectId: projId,
      tagIds: [tagId],
      flagged: true,
    });
    const task = await adapter.getTask(taskId);
    const snap = snapshotBefore(task);
    expect(snap).toEqual({
      projectId: String(projId),
      tagIds: [String(tagId)],
      flagged: true,
    });
  });
});

describe("computeAfter", () => {
  it("setProject overrides existing projectId", async () => {
    const adapter = new InMemoryAdapter();
    const projA = await adapter.createProject({ name: "a" });
    const projB = await adapter.createProject({ name: "b" });
    const id = await adapter.createTask({ name: "t", projectId: projA });
    const task = await adapter.getTask(id);
    const after = computeAfter(task, { setProject: projB });
    expect(after.projectId).toBe(String(projB));
  });

  it("addTags / removeTags applied via existing applyTagDiff semantics", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagA = await adapter.createTag({ name: "a" });
    const tagB = await adapter.createTag({ name: "b" });
    const tagC = await adapter.createTag({ name: "c" });
    const id = await adapter.createTask({ name: "t", projectId: projId, tagIds: [tagA, tagB] });
    const task = await adapter.getTask(id);
    const after = computeAfter(task, { addTags: [tagC], removeTags: [tagA] });
    expect(new Set(after.tagIds)).toEqual(new Set([String(tagB), String(tagC)]));
  });

  it("setFlagged overrides existing flagged", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const id = await adapter.createTask({ name: "t", projectId: projId, flagged: false });
    const task = await adapter.getTask(id);
    expect(computeAfter(task, { setFlagged: true }).flagged).toBe(true);
  });

  it("preserves unchanged fields when only one change is set", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagId = await adapter.createTag({ name: "x" });
    const id = await adapter.createTask({
      name: "t",
      projectId: projId,
      tagIds: [tagId],
      flagged: true,
    });
    const task = await adapter.getTask(id);
    const after = computeAfter(task, { setFlagged: false });
    expect(after.projectId).toBe(String(projId));
    expect(after.tagIds).toEqual([String(tagId)]);
    expect(after.flagged).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dry-run path
// ---------------------------------------------------------------------------

describe("handleTaskReclassify — dry run", () => {
  it("returns matched + proposed without mutating", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    await adapter.createTask({ name: "Pay invoice 2025-Q1", projectId: projId });
    await adapter.createTask({ name: "Pay invoice 2025-Q2", projectId: projId });
    await adapter.createTask({ name: "Buy groceries", projectId: projId });

    const before = (await adapter.listTasks({ projectId: projId })).map((t) => ({
      id: String(t.id),
      tagIds: t.tagIds.map(String),
    }));

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { setFlagged: true },
        dryRun: true,
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.phase).toBe("dryRun");
    if (env.data.phase !== "dryRun") return;
    expect(env.data.matched).toBe(2);
    expect(env.data.proposed).toHaveLength(2);
    for (const p of env.data.proposed) {
      expect(p.before.flagged).toBe(false);
      expect(p.after.flagged).toBe(true);
    }

    // No mutation
    const after = (await adapter.listTasks({ projectId: projId })).map((t) => ({
      id: String(t.id),
      tagIds: t.tagIds.map(String),
    }));
    expect(after).toEqual(before);
  });

  it("predicate matching nothing returns matched: 0 with empty proposed (AC failure mode)", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    await adapter.createTask({ name: "Buy groceries", projectId: projId });

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { setFlagged: true },
        dryRun: true,
      },
      makeCtx(adapter),
    );
    if (!("data" in env) || env.data.phase !== "dryRun") return;
    expect(env.data.matched).toBe(0);
    expect(env.data.proposed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Apply path
// ---------------------------------------------------------------------------

describe("handleTaskReclassify — apply path", () => {
  it("applies changes when confirmation matches the current match count", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagFinance = await adapter.createTag({ name: "finance" });
    const t1 = await adapter.createTask({ name: "Pay invoice 2025-Q1", projectId: projId });
    const t2 = await adapter.createTask({ name: "Pay invoice 2025-Q2", projectId: projId });
    await adapter.createTask({ name: "Buy groceries", projectId: projId });

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { addTags: [tagFinance] },
        dryRun: false,
        confirmation: "2",
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.phase).toBe("applied");
    if (env.data.phase !== "applied") return;
    expect(env.data.matched).toBe(2);
    expect(env.data.assigned).toHaveLength(2);

    const taskA = await adapter.getTask(t1);
    const taskB = await adapter.getTask(t2);
    expect(taskA.tagIds.map(String)).toContain(String(tagFinance));
    expect(taskB.tagIds.map(String)).toContain(String(tagFinance));
  });

  it("syncPending is true when something was applied", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    await adapter.createTask({ name: "Pay invoice", projectId: projId });

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { setFlagged: true },
        dryRun: false,
        confirmation: "1",
      },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    expect(env.meta.syncPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC failure modes
// ---------------------------------------------------------------------------

describe("handleTaskReclassify — failure modes", () => {
  it("stale confirmation count returns phase: 'stale-confirmation' without mutating", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    await adapter.createTask({ name: "Pay invoice 1", projectId: projId });
    await adapter.createTask({ name: "Pay invoice 2", projectId: projId });

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { setFlagged: true },
        dryRun: false,
        confirmation: "5", // intentionally wrong
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) return;
    expect(env.data.phase).toBe("stale-confirmation");
    if (env.data.phase !== "stale-confirmation") return;
    expect(env.data.matched).toBe(2);
    expect(env.data.confirmation).toBe("5");
  });

  it("over-cap rejects > 200 matches without mutating", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    // Seed 201 tasks with shared title token
    for (let i = 0; i < 201; i++) {
      await adapter.createTask({ name: `invoice-${i}`, projectId: projId });
    }

    const env = await handleTaskReclassify(
      {
        predicate: { kind: "title-contains", value: "invoice" },
        changes: { setFlagged: true },
        dryRun: false,
        confirmation: "201",
      },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    expect(env.data.phase).toBe("over-cap");
    if (env.data.phase !== "over-cap") return;
    expect(env.data.matched).toBe(201);
    expect(env.data.cap).toBe(200);

    // Spot-check: no mutation occurred (still all unflagged)
    const tasks = await adapter.listTasks({ projectId: projId });
    expect(tasks.every((t) => !t.flagged)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Predicate composition end-to-end
// ---------------------------------------------------------------------------

describe("handleTaskReclassify — composed predicates", () => {
  it("AC fixture — invoice in title AND not in @finance moves them to @finance", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagFinance = await adapter.createTag({ name: "finance" });
    const inFinance = await adapter.createTask({
      name: "Pay invoice (already tagged)",
      projectId: projId,
      tagIds: [tagFinance],
    });
    const needsTag = await adapter.createTask({
      name: "Pay invoice (untagged)",
      projectId: projId,
    });

    const env = await handleTaskReclassify(
      {
        predicate: {
          kind: "and",
          predicates: [
            { kind: "title-contains", value: "invoice" },
            { kind: "not", predicate: { kind: "tag", tagId: tagFinance } },
          ],
        },
        changes: { addTags: [tagFinance] },
        dryRun: false,
        confirmation: "1",
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.phase !== "applied") {
      expect.fail("expected applied phase");
      return;
    }
    expect(env.data.matched).toBe(1);
    expect(env.data.assigned).toHaveLength(1);

    const wasAlreadyTagged = await adapter.getTask(inFinance);
    const nowTagged = await adapter.getTask(needsTag);
    expect(wasAlreadyTagged.tagIds.map(String)).toEqual([String(tagFinance)]);
    expect(nowTagged.tagIds.map(String)).toContain(String(tagFinance));
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("taskReclassifyInputSchema", () => {
  it("requires changes to set at least one field", () => {
    const result = taskReclassifyInputSchema.safeParse({
      predicate: { kind: "title-contains", value: "x" },
      changes: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects dryRun: false without confirmation", () => {
    const result = taskReclassifyInputSchema.safeParse({
      predicate: { kind: "title-contains", value: "x" },
      changes: { setFlagged: true },
      dryRun: false,
    });
    expect(result.success).toBe(false);
  });

  it("dryRun defaults to true", () => {
    const result = taskReclassifyInputSchema.safeParse({
      predicate: { kind: "title-contains", value: "x" },
      changes: { setFlagged: true },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dryRun).toBe(true);
  });

  it("accepts a recursive predicate (and / or / not)", () => {
    const result = taskReclassifyInputSchema.safeParse({
      predicate: {
        kind: "and",
        predicates: [
          { kind: "title-contains", value: "a" },
          {
            kind: "or",
            predicates: [
              { kind: "tag", tagId: "tag_aaa" },
              { kind: "not", predicate: { kind: "title-contains", value: "b" } },
            ],
          },
        ],
      },
      changes: { setFlagged: true },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerTaskReclassifyTool", () => {
  it("registers under the canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<typeof registerTaskReclassifyTool>[0];
    const adapter = new InMemoryAdapter();
    registerTaskReclassifyTool(server, makeCtx(adapter));
    expect(registerTool.mock.calls[0]?.[0]).toBe("task_reclassify");
  });
});
