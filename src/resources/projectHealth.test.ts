/**
 * Unit tests for the project-health resource.
 *
 * Covers buildProjectHealthPayload, the per-project signal computation, the
 * flag-conditions filter, the severity sort, and the staleDays-override
 * parameter parsing.
 */

import { describe, expect, it } from "vitest";

import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { STALLED_DAYS } from "../domain/health.js";
import type { Task } from "../domain/task.js";

import {
  buildProjectHealthPayload,
  buildProjectSignals,
  PROJECT_HEALTH_URI_TEMPLATE,
  parseStaleDays,
} from "./projectHealth.js";

const NOW = new Date("2026-04-01T12:00:00.000Z"); // Wednesday

// ---------------------------------------------------------------------------
// Empty database
// ---------------------------------------------------------------------------

describe("buildProjectHealthPayload — empty database", () => {
  it("returns empty list and the default staleDays", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);
    expect(payload.projects).toEqual([]);
    expect(payload.staleDays).toBe(STALLED_DAYS);
    expect(payload.generatedAt).toBe(NOW.toISOString());
  });

  it("echoes back the override staleDays", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildProjectHealthPayload(adapter, 7, NOW);
    expect(payload.staleDays).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Filter: only flagged projects appear
// ---------------------------------------------------------------------------

describe("buildProjectHealthPayload — flag filter", () => {
  it("excludes a healthy project (recent activity, has available task, just reviewed)", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "healthy", reviewIntervalDays: 30 });
    await adapter.createTask({ name: "open", projectId: projId });
    await adapter.markProjectReviewed(projId);

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    expect(payload.projects.find((p) => p.name === "healthy")).toBeUndefined();
  });

  it("includes a project with zero available tasks", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "no-actions", reviewIntervalDays: 30 });
    await adapter.markProjectReviewed(projId);
    // Project has no tasks → hasNoActions=true → availableTaskCount=0 → flagged

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    const entry = payload.projects.find((p) => p.name === "no-actions");
    expect(entry).toBeDefined();
    expect(entry?.signals.hasNoActions).toBe(true);
    expect(entry?.signals.availableTaskCount).toBe(0);
  });

  it("includes a project overdue for review (never reviewed)", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "no-review" });
    await adapter.createTask({ name: "open", projectId: projId });
    // Never reviewed; nextReviewDate=null → overdueForReview=true

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    const entry = payload.projects.find((p) => p.name === "no-review");
    expect(entry).toBeDefined();
    expect(entry?.signals.overdueForReview).toBe(true);
    expect(entry?.signals.lastReviewedAt).toBeNull();
  });

  it("excludes on-hold and completed projects", async () => {
    const adapter = new InMemoryAdapter();
    const a = await adapter.createProject({ name: "on-hold-with-no-actions" });
    const b = await adapter.createProject({ name: "done-with-no-actions" });
    await adapter.updateProject(a, { status: "on-hold" });
    await adapter.completeProject(b);

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    expect(payload.projects.find((p) => p.name === "on-hold-with-no-actions")).toBeUndefined();
    expect(payload.projects.find((p) => p.name === "done-with-no-actions")).toBeUndefined();
  });

  it("flags a project where every open task is deferred into the future", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "all-deferred", reviewIntervalDays: 30 });
    await adapter.markProjectReviewed(projId);
    // Defer the only task into the future
    await adapter.createTask({
      name: "future",
      projectId: projId,
      deferDate: "2099-01-01T00:00:00.000Z",
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    const entry = payload.projects.find((p) => p.name === "all-deferred");
    expect(entry).toBeDefined();
    expect(entry?.signals.deferredFutureTasks).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Severity sort
// ---------------------------------------------------------------------------

describe("buildProjectHealthPayload — sort", () => {
  it("places review-overdue projects before activity-stale projects", async () => {
    const adapter = new InMemoryAdapter();
    // A: stale activity, recently reviewed → only flagged via no-available-tasks
    const a = await adapter.createProject({ name: "A-stale", reviewIntervalDays: 365 });
    await adapter.markProjectReviewed(a);
    // B: never reviewed, has open task → flagged via overdueForReview
    const b = await adapter.createProject({ name: "B-overdue-review" });
    await adapter.createTask({ name: "open", projectId: b });

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    const idxA = payload.projects.findIndex((p) => p.name === "A-stale");
    const idxB = payload.projects.findIndex((p) => p.name === "B-overdue-review");
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeGreaterThanOrEqual(0);
    // B (review-overdue) should sort before A
    expect(idxB).toBeLessThan(idxA);
  });

  it("uses name as a stable tiebreaker for equal-severity projects", async () => {
    const adapter = new InMemoryAdapter();
    // Two no-actions, never-reviewed projects → identical severity
    await adapter.createProject({ name: "Zeta" });
    await adapter.createProject({ name: "Alpha" });

    const payload = await buildProjectHealthPayload(adapter, undefined, new Date());
    const names = payload.projects.map((p) => p.name);
    expect(names.indexOf("Alpha")).toBeLessThan(names.indexOf("Zeta"));
  });
});

// ---------------------------------------------------------------------------
// staleDays override
// ---------------------------------------------------------------------------

describe("buildProjectHealthPayload — staleDays override", () => {
  it("applying a small staleDays threshold flags more projects via stalled-activity", async () => {
    const adapter = new InMemoryAdapter();
    // Recently-reviewed project with one available task — would NOT be flagged
    // by the default conditions (has actions, just reviewed). But with
    // staleDays=0 the activity-staleness fires immediately because the
    // task's modifiedAt equals "right now", which is ≥ 0 days ago.
    const projId = await adapter.createProject({ name: "edge-case", reviewIntervalDays: 30 });
    await adapter.markProjectReviewed(projId);
    await adapter.createTask({ name: "open", projectId: projId });

    const baseline = await buildProjectHealthPayload(adapter, undefined, new Date());
    expect(baseline.projects.find((p) => p.name === "edge-case")).toBeUndefined();

    const aggressive = await buildProjectHealthPayload(adapter, 0, new Date());
    // With staleDays=0, every active project is "stalled" and thus flagged.
    expect(aggressive.projects.find((p) => p.name === "edge-case")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Per-project signals — direct unit tests on the pure helper
// ---------------------------------------------------------------------------

describe("buildProjectSignals", () => {
  function makeTask(overrides: Partial<Task>): Task {
    return {
      id: "t" as Task["id"],
      name: "task",
      note: null,
      noteHtml: null,
      projectId: "p" as Task["projectId"],
      parentId: null,
      tagIds: [],
      deferDate: null,
      dueDate: null,
      estimatedMinutes: null,
      flagged: false,
      completed: false,
      completedAt: null,
      dropped: false,
      droppedAt: null,
      available: true,
      blocked: false,
      sequential: false,
      completedByChildren: false,
      repetition: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    } as Task;
  }

  it("derives lastTaskActivityAt from max(task.modifiedAt)", () => {
    const tasks = [
      makeTask({ modifiedAt: "2026-02-01T00:00:00.000Z" }),
      makeTask({ modifiedAt: "2026-03-01T00:00:00.000Z" }),
      makeTask({ modifiedAt: "2026-01-15T00:00:00.000Z" }),
    ];
    const signals = buildProjectSignals(
      { modifiedAt: "2025-12-01T00:00:00.000Z", nextReviewDate: null, lastReviewDate: null },
      tasks,
      NOW,
    );
    expect(signals.lastTaskActivityAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("falls back to project.modifiedAt when there are no tasks", () => {
    const signals = buildProjectSignals(
      { modifiedAt: "2026-01-01T00:00:00.000Z", nextReviewDate: null, lastReviewDate: null },
      [],
      NOW,
    );
    expect(signals.lastTaskActivityAt).toBeNull();
    // daysSinceActivity should still derive from the project's modifiedAt
    expect(signals.daysSinceActivity).toBeGreaterThan(0);
  });

  it("counts only open tasks toward available/blocked", () => {
    const tasks = [
      makeTask({ id: "1" as Task["id"], available: true }),
      makeTask({ id: "2" as Task["id"], blocked: true, available: false }),
      makeTask({ id: "3" as Task["id"], completed: true }), // ignored
      makeTask({ id: "4" as Task["id"], dropped: true }), // ignored
    ];
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: NOW.toISOString(), lastReviewDate: null },
      tasks,
      NOW,
    );
    expect(signals.availableTaskCount).toBe(1);
    expect(signals.blockedTaskCount).toBe(1);
  });

  it("hasNoActions is true when every task is completed/dropped or there are no tasks", () => {
    const tasks = [
      makeTask({ id: "a" as Task["id"], completed: true }),
      makeTask({ id: "b" as Task["id"], dropped: true }),
    ];
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      tasks,
      NOW,
    );
    expect(signals.hasNoActions).toBe(true);
  });

  it("deferredFutureTasks requires open tasks AND every open task to have a future defer date", () => {
    const futureIso = "2099-01-01T00:00:00.000Z";
    const tasks = [
      makeTask({ id: "x" as Task["id"], deferDate: futureIso }),
      makeTask({ id: "y" as Task["id"], deferDate: futureIso }),
    ];
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      tasks,
      NOW,
    );
    expect(signals.deferredFutureTasks).toBe(true);
  });

  it("deferredFutureTasks is false when at least one open task has no defer date", () => {
    const tasks = [
      makeTask({ id: "x" as Task["id"], deferDate: "2099-01-01T00:00:00.000Z" }),
      makeTask({ id: "y" as Task["id"], deferDate: null }),
    ];
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      tasks,
      NOW,
    );
    expect(signals.deferredFutureTasks).toBe(false);
  });

  it("deferredFutureTasks is false when there are zero open tasks", () => {
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      [],
      NOW,
    );
    expect(signals.deferredFutureTasks).toBe(false);
  });

  it("overdueForReview is true when nextReviewDate is null", () => {
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      [],
      NOW,
    );
    expect(signals.overdueForReview).toBe(true);
  });

  it("overdueForReview is true when nextReviewDate <= now", () => {
    const signals = buildProjectSignals(
      {
        modifiedAt: NOW.toISOString(),
        nextReviewDate: "2026-03-01T00:00:00.000Z",
        lastReviewDate: null,
      },
      [],
      NOW,
    );
    expect(signals.overdueForReview).toBe(true);
  });

  it("overdueForReview is false when nextReviewDate is in the future", () => {
    const signals = buildProjectSignals(
      {
        modifiedAt: NOW.toISOString(),
        nextReviewDate: "2099-01-01T00:00:00.000Z",
        lastReviewDate: "2026-01-01T00:00:00.000Z",
      },
      [],
      NOW,
    );
    expect(signals.overdueForReview).toBe(false);
  });

  it("daysSinceReview is null when never reviewed", () => {
    const signals = buildProjectSignals(
      { modifiedAt: NOW.toISOString(), nextReviewDate: null, lastReviewDate: null },
      [],
      NOW,
    );
    expect(signals.daysSinceReview).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseStaleDays
// ---------------------------------------------------------------------------

describe("parseStaleDays", () => {
  it("returns the default for missing input", () => {
    expect(parseStaleDays(undefined)).toBe(STALLED_DAYS);
    expect(parseStaleDays("")).toBe(STALLED_DAYS);
  });

  it("parses positive integers", () => {
    expect(parseStaleDays("7")).toBe(7);
    expect(parseStaleDays("30")).toBe(30);
  });

  it("falls back to default for non-positive values", () => {
    expect(parseStaleDays("0")).toBe(STALLED_DAYS);
    expect(parseStaleDays("-3")).toBe(STALLED_DAYS);
  });

  it("falls back to default for malformed values", () => {
    expect(parseStaleDays("abc")).toBe(STALLED_DAYS);
    expect(parseStaleDays("1.5")).toBe(1); // parseInt truncates; 1 is valid
  });
});

// ---------------------------------------------------------------------------
// URI template export
// ---------------------------------------------------------------------------

describe("PROJECT_HEALTH_URI_TEMPLATE", () => {
  it("is the canonical project-health URI template", () => {
    expect(PROJECT_HEALTH_URI_TEMPLATE).toBe("omnifocus://project-health{?staleDays}");
  });
});

// ---------------------------------------------------------------------------
// Decision-journal honoring (#485 slice 2)
// ---------------------------------------------------------------------------

describe("buildProjectHealthPayload — decision-journal honoring", () => {
  function decisionFence(opts: {
    kind: string;
    reason: string;
    recordedAt: string;
    until?: string;
  }): string {
    const lines = [
      "```decision-journal",
      `kind: ${opts.kind}`,
      `reason: ${opts.reason}`,
      `recordedAt: ${opts.recordedAt}`,
    ];
    if (opts.until !== undefined) lines.push(`until: ${opts.until}`);
    lines.push("```");
    return lines.join("\n");
  }

  it("partitions a flagged project with an active decision into `acknowledged`, not `projects`", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({ name: "no-action-no-decision" });
    await adapter.createProject({
      name: "deliberately-stalled",
      note: decisionFence({
        kind: "stall-is-intentional",
        reason: "Strategic pause until Q3 budget cycle",
        recordedAt: "2026-04-01T10:00:00Z",
      }),
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);

    expect(payload.projects.find((p) => p.name === "deliberately-stalled")).toBeUndefined();
    const inAcknowledged = payload.acknowledged.find((p) => p.name === "deliberately-stalled");
    expect(inAcknowledged).toBeDefined();
    expect(inAcknowledged?.decision?.kind).toBe("stall-is-intentional");
    expect(inAcknowledged?.decision?.reason).toContain("Strategic pause");

    expect(payload.projects.find((p) => p.name === "no-action-no-decision")).toBeDefined();
  });

  it("expired decisions (until in the past) re-emerge in `projects`", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({
      name: "expired-decision",
      note: decisionFence({
        kind: "deferred-by-choice",
        reason: "Wait for Alice's review",
        recordedAt: "2026-01-01T10:00:00Z",
        until: "2026-03-01T10:00:00Z", // before NOW = 2026-04-01
      }),
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);

    expect(payload.acknowledged.find((p) => p.name === "expired-decision")).toBeUndefined();
    expect(payload.projects.find((p) => p.name === "expired-decision")).toBeDefined();
  });

  it("active decisions with future `until` keep the project in `acknowledged`", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({
      name: "future-until",
      note: decisionFence({
        kind: "blocked-on-external",
        reason: "Waiting on vendor SDK",
        recordedAt: "2026-04-01T10:00:00Z",
        until: "2099-01-01T10:00:00Z",
      }),
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);
    expect(payload.acknowledged.find((p) => p.name === "future-until")).toBeDefined();
    expect(payload.projects.find((p) => p.name === "future-until")).toBeUndefined();
  });

  it("a project with a malformed decision fence is treated as no-decision (still flagged)", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({
      name: "malformed",
      note: "```decision-journal\nthis is not valid yaml at all\n```",
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);
    expect(payload.acknowledged.find((p) => p.name === "malformed")).toBeUndefined();
    expect(payload.projects.find((p) => p.name === "malformed")).toBeDefined();
  });

  it("returns empty `acknowledged` array (never undefined) when no decisions are present", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);
    expect(payload.acknowledged).toEqual([]);
  });

  it("acknowledged entries are sorted by name within equal severity", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({
      name: "beta",
      note: decisionFence({
        kind: "stall-is-intentional",
        reason: "y",
        recordedAt: "2026-04-01T10:00:00Z",
      }),
    });
    await adapter.createProject({
      name: "alpha",
      note: decisionFence({
        kind: "stall-is-intentional",
        reason: "x",
        recordedAt: "2026-04-01T10:00:00Z",
      }),
    });

    const payload = await buildProjectHealthPayload(adapter, undefined, NOW);
    const names = payload.acknowledged.map((p) => p.name);
    expect(names).toEqual(["alpha", "beta"]);
  });
});
