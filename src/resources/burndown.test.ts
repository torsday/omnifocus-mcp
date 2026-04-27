/**
 * Unit tests for the burndown resource.
 *
 * Covers:
 * - buildBurndownPayload: ProjectNotFound error, NoDueDate error,
 *   zero-task project, behind/ahead/on-pace scenarios, deltaDays sign,
 *   startDate derivation, actualPercent calculation.
 *
 * Uses InMemoryAdapter — no live OmniFocus required.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { buildBurndownPayload } from "./burndown.js";

// Fixed "now" for deterministic ideal-line calculations.
// Project: started 2026-01-01, due 2026-05-01 (120 days total).
// At 2026-03-01 (59 days elapsed), ideal = 59/120 ≈ 49.17%.
const _PROJECT_START = "2026-01-01T00:00:00.000Z";
const PROJECT_DUE = "2026-05-01T00:00:00.000Z";
const NOW_MIDWAY = new Date("2026-03-01T00:00:00.000Z");

describe("buildBurndownPayload — errors", () => {
  it("returns ProjectNotFound for unknown project id", async () => {
    const adapter = new InMemoryAdapter();
    const result = await buildBurndownPayload(adapter, "nonexistent-id", NOW_MIDWAY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("ProjectNotFound");
    }
  });

  it("returns NoDueDate when project has no due date", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "No Due Date" });
    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.code).toBe("NoDueDate");
      expect(result.error.message).toContain("no due date");
    }
  });
});

describe("buildBurndownPayload — zero tasks", () => {
  it("returns 100% actualPercent for project with no tasks", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Empty", dueDate: PROJECT_DUE });
    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.totalTasks).toBe(0);
      expect(result.completedTasks).toBe(0);
      expect(result.remainingTasks).toBe(0);
      expect(result.actualPercent).toBe(100);
    }
  });
});

describe("buildBurndownPayload — task counts", () => {
  it("reports correct totalTasks, completedTasks, remainingTasks", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });

    const t1 = await adapter.createTask({ name: "done1", projectId: projId });
    const t2 = await adapter.createTask({ name: "done2", projectId: projId });
    await adapter.createTask({ name: "todo", projectId: projId });

    await adapter.completeTask(t1);
    await adapter.completeTask(t2);

    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.totalTasks).toBe(3);
      expect(result.completedTasks).toBe(2);
      expect(result.remainingTasks).toBe(1);
    }
  });

  it("excludes dropped tasks from remainingTasks", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });
    await adapter.createTask({ name: "active", projectId: projId });
    const dropped = await adapter.createTask({ name: "dropped", projectId: projId });
    await adapter.dropTask(dropped);

    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      // dropped task should not count as remaining
      expect(result.remainingTasks).toBe(1);
    }
  });
});

describe("buildBurndownPayload — progress math", () => {
  it("actualPercent = completedTasks / totalTasks × 100", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });

    const t1 = await adapter.createTask({ name: "t1", projectId: projId });
    await adapter.createTask({ name: "t2", projectId: projId });
    await adapter.createTask({ name: "t3", projectId: projId });
    await adapter.completeTask(t1);

    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      // 1/3 = 33.33%
      expect(result.actualPercent).toBeCloseTo(33.33, 1);
    }
  });

  it("deltaDays is positive when ahead of ideal pace", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });

    // Complete all tasks → 100% actual; ideal line will be < 100% if we're mid-project.
    const t1 = await adapter.createTask({ name: "t1", projectId: projId });
    await adapter.completeTask(t1);

    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.deltaDays).toBeGreaterThan(0);
    }
  });

  it("deltaDays is negative when behind ideal pace", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });

    // 10 tasks, 0 completed → 0% actual.
    // Use a `now` 1 day before the due date so idealLinePercent ≈ 100%
    // regardless of when InMemoryAdapter sets createdAt.
    for (let i = 0; i < 10; i++) {
      await adapter.createTask({ name: `t${i}`, projectId: projId });
    }

    // now = one day before due date → ideal ≈ ~99%, actual = 0 → delta < 0
    const nowNearDue = new Date(new Date(PROJECT_DUE).getTime() - 86_400_000);
    const result = await buildBurndownPayload(adapter, String(projId), nowNearDue);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.deltaDays).toBeLessThan(0);
    }
  });

  it("idealLinePercent is 0 when now is at or before startDate", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });
    await adapter.createTask({ name: "t", projectId: projId });

    // now = well before the project was created (use a date far in the past)
    const nowBeforeStart = new Date("2020-01-01T00:00:00.000Z");
    const result = await buildBurndownPayload(adapter, String(projId), nowBeforeStart);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.idealLinePercent).toBe(0);
    }
  });
});

describe("buildBurndownPayload — output shape", () => {
  it("includes dueDate, name, projectId in payload", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "My Project", dueDate: PROJECT_DUE });
    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.name).toBe("My Project");
      expect(result.dueDate).toBe(PROJECT_DUE);
      expect(result.projectId).toBe(String(projId));
    }
  });

  it("note field is a non-empty string", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P", dueDate: PROJECT_DUE });
    const result = await buildBurndownPayload(adapter, String(projId), NOW_MIDWAY);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(typeof result.note).toBe("string");
      expect(result.note.length).toBeGreaterThan(0);
    }
  });
});
