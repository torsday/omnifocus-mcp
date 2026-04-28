/**
 * Unit tests for the `task_find_similar` tool.
 *
 * Scoring behaviour is covered exhaustively in
 * `src/domain/textSimilarity.test.ts`. These tests cover the tool seam:
 * adapter integration (filter pass-through, scope narrowing,
 * includeCompleted toggle), top-K limiting, score-zero filtering, the
 * AC integration scenario (3 near-duplicates → all returned in score
 * order), and registration.
 */

import { describe, expect, it, vi } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";

import {
  handleTaskFindSimilar,
  registerTaskFindSimilarTool,
  taskFindSimilarInputSchema,
} from "./findSimilar.js";

const META: ResponseMeta = {
  correlationId: "01TESTFINDSIMILAR",
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
// Empty result is not an error (AC)
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — empty result", () => {
  it("returns { candidates: [] } for an empty database", async () => {
    const adapter = new InMemoryAdapter();
    const env = await handleTaskFindSimilar(
      { name: "anything", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    expect(env.data.candidates).toEqual([]);
  });

  it("returns { candidates: [] } when no task shares any token with the reference", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    await adapter.createTask({ name: "Buy groceries", projectId: projId });
    await adapter.createTask({ name: "Mow the lawn", projectId: projId });

    const env = await handleTaskFindSimilar(
      { name: "Refactor authentication module", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    expect(env.data.candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC integration scenario — 3 near-duplicates, all returned in score order
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — near-duplicate ranking (AC fixture)", () => {
  it("returns three near-duplicates in descending score order", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });

    // Three tasks that all share lexical signal with "Call dentist"
    const t1 = await adapter.createTask({ name: "Call dentist", projectId: projId });
    const t2 = await adapter.createTask({
      name: "Call dentist about insurance",
      projectId: projId,
    });
    const t3 = await adapter.createTask({
      name: "Schedule dentist appointment",
      projectId: projId,
    });
    // A clearly disjoint distractor
    await adapter.createTask({ name: "Buy groceries", projectId: projId });

    const env = await handleTaskFindSimilar(
      { name: "Call the dentist", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env)) {
      expect.fail("expected ok envelope");
      return;
    }
    const ids = env.data.candidates.map((c) => c.taskId);
    expect(ids).toContain(String(t1));
    expect(ids).toContain(String(t2));
    expect(ids).toContain(String(t3));

    // Disjoint distractor must not appear
    const names = env.data.candidates.map((c) => c.name);
    expect(names).not.toContain("Buy groceries");

    // Descending score
    for (let i = 1; i < env.data.candidates.length; i++) {
      const prev = env.data.candidates[i - 1];
      const curr = env.data.candidates[i];
      if (prev !== undefined && curr !== undefined) {
        expect(prev.score).toBeGreaterThanOrEqual(curr.score);
      }
    }

    // The exact-match candidate ranks first
    expect(env.data.candidates[0]?.taskId).toBe(String(t1));
  });
});

// ---------------------------------------------------------------------------
// includeCompleted toggle
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — includeCompleted", () => {
  it("excludes completed tasks by default", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const open = await adapter.createTask({ name: "Call dentist (open)", projectId: projId });
    const completed = await adapter.createTask({
      name: "Call dentist (done)",
      projectId: projId,
    });
    await adapter.completeTask(completed);

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    const ids = env.data.candidates.map((c) => c.taskId);
    expect(ids).toContain(String(open));
    expect(ids).not.toContain(String(completed));
  });

  it("includes completed tasks when includeCompleted=true", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const completed = await adapter.createTask({
      name: "Call dentist (done)",
      projectId: projId,
    });
    await adapter.completeTask(completed);

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 5, includeCompleted: true },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    expect(env.data.candidates.map((c) => c.taskId)).toContain(String(completed));
  });
});

// ---------------------------------------------------------------------------
// Scope narrowing
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — scope filter", () => {
  it("narrows candidates to a single project when scope.projectId is set", async () => {
    const adapter = new InMemoryAdapter();
    const projA = await adapter.createProject({ name: "A" });
    const projB = await adapter.createProject({ name: "B" });
    const inA = await adapter.createTask({ name: "Call dentist", projectId: projA });
    const inB = await adapter.createTask({ name: "Call dentist", projectId: projB });

    const env = await handleTaskFindSimilar(
      {
        name: "Call dentist",
        limit: 5,
        includeCompleted: false,
        scope: { projectId: projA },
      },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    const ids = env.data.candidates.map((c) => c.taskId);
    expect(ids).toContain(String(inA));
    expect(ids).not.toContain(String(inB));
  });

  it("narrows candidates to a single tag when scope.tagId is set", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagX = await adapter.createTag({ name: "x" });
    const tagged = await adapter.createTask({
      name: "Call dentist",
      projectId: projId,
      tagIds: [tagX],
    });
    const untagged = await adapter.createTask({ name: "Call dentist", projectId: projId });

    const env = await handleTaskFindSimilar(
      {
        name: "Call dentist",
        limit: 5,
        includeCompleted: false,
        scope: { tagId: tagX },
      },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    const ids = env.data.candidates.map((c) => c.taskId);
    expect(ids).toContain(String(tagged));
    expect(ids).not.toContain(String(untagged));
  });
});

// ---------------------------------------------------------------------------
// Top-K limiting
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — limit", () => {
  it("respects the requested top-K", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    for (let i = 0; i < 10; i++) {
      await adapter.createTask({ name: `Call dentist variant ${i}`, projectId: projId });
    }

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 3, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env)) return;
    expect(env.data.candidates).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("handleTaskFindSimilar — candidate shape", () => {
  it("each candidate has taskId, name, score, projectId, tags", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "p" });
    const tagId = await adapter.createTag({ name: "errands" });
    await adapter.createTask({
      name: "Call dentist",
      projectId: projId,
      tagIds: [tagId],
    });

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env) || env.data.candidates.length === 0) {
      expect.fail("expected one candidate");
      return;
    }
    const candidate = env.data.candidates[0];
    expect(candidate).toMatchObject({
      taskId: expect.any(String),
      name: expect.any(String),
      score: expect.any(Number),
      tags: expect.any(Array),
    });
    expect(candidate?.project?.id).toBe(String(projId));
    expect(candidate?.tags.map((t) => t.id)).toContain(String(tagId));
  });

  it("inbox tasks (no project) report project: null", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createTask({ name: "Call dentist" }); // inbox

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env) || env.data.candidates.length === 0) {
      expect.fail("expected one candidate");
      return;
    }
    expect(env.data.candidates[0]?.project).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("taskFindSimilarInputSchema", () => {
  it("requires a non-empty name", () => {
    const result = taskFindSimilarInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects scope with both projectId and tagId", () => {
    const result = taskFindSimilarInputSchema.safeParse({
      name: "x",
      scope: { projectId: "abc123def456", tagId: "tag_aaa" },
    });
    expect(result.success).toBe(false);
  });

  it("limit defaults to 5 when omitted", () => {
    const result = taskFindSimilarInputSchema.safeParse({ name: "x" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.limit).toBe(5);
  });

  it("includeCompleted defaults to false when omitted", () => {
    const result = taskFindSimilarInputSchema.safeParse({ name: "x" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeCompleted).toBe(false);
  });

  it("rejects limit > 50", () => {
    const result = taskFindSimilarInputSchema.safeParse({ name: "x", limit: 51 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("registerTaskFindSimilarTool", () => {
  it("registers under the canonical name", () => {
    const registerTool = vi.fn();
    const server = { registerTool } as unknown as Parameters<typeof registerTaskFindSimilarTool>[0];
    const adapter = new InMemoryAdapter();
    registerTaskFindSimilarTool(server, makeCtx(adapter));
    expect(registerTool).toHaveBeenCalledTimes(1);
    expect(registerTool.mock.calls[0]?.[0]).toBe("task_find_similar");
  });
});

// ---------------------------------------------------------------------------
// Name pairing (#608)
// ---------------------------------------------------------------------------

describe("task_find_similar pairs ids with names (#608)", () => {
  it("returns project { id, name } and tags [{ id, name }] for paired candidates", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Health" });
    const tagId1 = await adapter.createTag({ name: "errand" });
    const tagId2 = await adapter.createTag({ name: "phone" });
    await adapter.createTask({
      name: "Call dentist",
      projectId: projId,
      tagIds: [tagId1, tagId2],
    });

    const env = await handleTaskFindSimilar(
      { name: "Call dentist", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    if (!("data" in env) || env.data.candidates.length === 0) {
      expect.fail("expected one candidate");
      return;
    }
    const c = env.data.candidates[0];
    expect(c?.project).toEqual({ id: String(projId), name: "Health" });
    expect(c?.tags).toEqual(
      expect.arrayContaining([
        { id: String(tagId1), name: "errand" },
        { id: String(tagId2), name: "phone" },
      ]),
    );
    expect(c?.tags).toHaveLength(2);
  });

  it("batches lookups into a single getProjectsMany + single getTagsMany call", async () => {
    const adapter = new InMemoryAdapter();
    const projA = await adapter.createProject({ name: "Project A" });
    const projB = await adapter.createProject({ name: "Project B" });
    const tagX = await adapter.createTag({ name: "x" });
    const tagY = await adapter.createTag({ name: "y" });
    // Three candidates: two share projA, one is in projB; tags vary.
    await adapter.createTask({ name: "Call dentist", projectId: projA, tagIds: [tagX] });
    await adapter.createTask({ name: "Call doctor", projectId: projA, tagIds: [tagX, tagY] });
    await adapter.createTask({ name: "Call plumber", projectId: projB, tagIds: [tagY] });

    const projSpy = vi.spyOn(adapter, "getProjectsMany");
    const tagSpy = vi.spyOn(adapter, "getTagsMany");

    const env = await handleTaskFindSimilar(
      { name: "Call", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    expect("data" in env && env.data.candidates.length).toBeGreaterThan(0);
    expect(projSpy).toHaveBeenCalledTimes(1);
    expect(tagSpy).toHaveBeenCalledTimes(1);
    // Distinct ids passed: projA + projB; tagX + tagY.
    expect(projSpy.mock.calls[0]?.[0]).toHaveLength(2);
    expect(tagSpy.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("skips name lookups entirely when no candidates survive scoring", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Health" });
    await adapter.createTask({ name: "Buy milk", projectId: projId });

    const projSpy = vi.spyOn(adapter, "getProjectsMany");
    const tagSpy = vi.spyOn(adapter, "getTagsMany");

    const env = await handleTaskFindSimilar(
      { name: "completely unrelated phrase xyzzy", limit: 5, includeCompleted: false },
      makeCtx(adapter),
    );
    expect("data" in env && env.data.candidates).toEqual([]);
    expect(projSpy).not.toHaveBeenCalled();
    expect(tagSpy).not.toHaveBeenCalled();
  });
});
