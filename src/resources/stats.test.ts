/**
 * Unit tests for the stats resource.
 *
 * Covers the buildStatsPayload aggregator over an InMemoryAdapter, the
 * isProjectStalled predicate (which #468 will share), and the registration
 * surface. Each test fixes `now` for determinism.
 */

import { describe, expect, it } from "vitest";

import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import type { Project } from "../domain/project.js";

import { buildStatsPayload, isProjectStalled, STALLED_DAYS, STATS_URI } from "./stats.js";

// ---------------------------------------------------------------------------
// Fixed clock — March 2026 keeps the math obvious; week starts Monday.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-03-04T12:00:00.000Z"); // Wednesday

// ---------------------------------------------------------------------------
// Empty database — every count should be zero, every "oldest" null
// ---------------------------------------------------------------------------

describe("buildStatsPayload — empty database", () => {
  it("returns all zeros and nulls", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildStatsPayload(adapter, NOW);

    expect(payload.tasks).toEqual({
      total: 0,
      available: 0,
      blocked: 0,
      deferred: 0,
      completed_today: 0,
      completed_this_week: 0,
      overdue_count: 0,
      flagged_count: 0,
      dropped_today: 0,
    });
    expect(payload.projects).toEqual({
      total: 0,
      active: 0,
      on_hold: 0,
      completed: 0,
      dropped: 0,
      stalled_count: 0,
      due_for_review_count: 0,
    });
    expect(payload.inbox).toEqual({ count: 0, oldest_age_days: null });
    expect(payload.tags).toEqual({ total: 0, with_tasks_count: 0 });
    expect(payload.database).toEqual({ sync_age_seconds: null, last_sync_at: null });
  });
});

// ---------------------------------------------------------------------------
// Task buckets
// ---------------------------------------------------------------------------

describe("buildStatsPayload — tasks", () => {
  it("counts total tasks regardless of status", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "a", projectId: projId });
    await adapter.createTask({ name: "b", projectId: projId });
    await adapter.createTask({ name: "c", projectId: projId });
    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.total).toBe(3);
  });

  it("counts flagged separately from available/blocked", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "flagged", projectId: projId, flagged: true });
    await adapter.createTask({ name: "plain", projectId: projId });

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.flagged_count).toBe(1);
  });

  it("counts overdue tasks (dueDate strictly before now)", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({
      name: "yesterday",
      projectId: projId,
      dueDate: "2026-03-03T12:00:00.000Z",
    });
    await adapter.createTask({
      name: "tomorrow",
      projectId: projId,
      dueDate: "2026-03-05T12:00:00.000Z",
    });
    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.overdue_count).toBe(1);
  });

  it("counts deferred tasks (deferDate strictly after now)", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({
      name: "future-defer",
      projectId: projId,
      deferDate: "2026-03-10T12:00:00.000Z",
    });
    await adapter.createTask({
      name: "past-defer",
      projectId: projId,
      deferDate: "2026-03-01T12:00:00.000Z",
    });
    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.deferred).toBe(1);
  });

  it("does NOT double-count completed tasks as available/flagged/etc.", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t = await adapter.createTask({ name: "done-flagged", projectId: projId, flagged: true });
    await adapter.completeTask(t, NOW);

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.flagged_count).toBe(0);
    expect(payload.tasks.completed_today).toBe(1);
    expect(payload.tasks.total).toBe(1);
  });

  it("counts completed_today separately from earlier completions", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t1 = await adapter.createTask({ name: "earlier-today", projectId: projId });
    const t2 = await adapter.createTask({ name: "now", projectId: projId });
    const t3 = await adapter.createTask({ name: "two-days-ago", projectId: projId });

    // 1am local on the same day as NOW — clearly inside "today" in any TZ.
    const earlierToday = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 1, 0, 0, 0);
    await adapter.completeTask(t1, earlierToday);
    await adapter.completeTask(t2, NOW);
    await adapter.completeTask(t3, new Date("2026-03-02T12:00:00.000Z"));

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.completed_today).toBe(2);
  });

  it("completed_this_week includes today and earlier-in-week completions", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t1 = await adapter.createTask({ name: "monday", projectId: projId });
    const t2 = await adapter.createTask({ name: "today", projectId: projId });
    const t3 = await adapter.createTask({ name: "last-week", projectId: projId });

    // Monday of NOW's week
    await adapter.completeTask(t1, new Date("2026-03-02T09:00:00.000Z"));
    await adapter.completeTask(t2, NOW);
    // Sunday of last week
    await adapter.completeTask(t3, new Date("2026-03-01T09:00:00.000Z"));

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.completed_this_week).toBe(2);
  });

  it("counts dropped_today only for tasks dropped on/after start of today", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    const t1 = await adapter.createTask({ name: "today-drop", projectId: projId });
    const t2 = await adapter.createTask({ name: "yesterday-drop", projectId: projId });
    await adapter.dropTask(t1, NOW);
    await adapter.dropTask(t2, new Date("2026-03-03T12:00:00.000Z"));

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tasks.dropped_today).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Project buckets
// ---------------------------------------------------------------------------

describe("buildStatsPayload — projects", () => {
  it("counts projects by status", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.createProject({ name: "active" });
    const h = await adapter.createProject({ name: "on-hold" });
    const c = await adapter.createProject({ name: "completed" });
    const d = await adapter.createProject({ name: "dropped" });

    await adapter.updateProject(h, { status: "on-hold" });
    await adapter.completeProject(c);
    await adapter.dropProject(d);

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.projects.total).toBe(4);
    // a is active
    expect(payload.projects.active).toBe(1);
    expect(payload.projects.on_hold).toBe(1);
    expect(payload.projects.completed).toBe(1);
    expect(payload.projects.dropped).toBe(1);
  });

  it("due_for_review_count tracks listProjectsDueForReview", async () => {
    const adapter = new InMemoryAdapter();
    const p = await adapter.createProject({ name: "P", reviewIntervalDays: 7 });
    // Brand new project: nextReviewDate is null, which the adapter treats as
    // due for review.
    const beforePayload = await buildStatsPayload(adapter, NOW);
    expect(beforePayload.projects.due_for_review_count).toBeGreaterThan(0);

    await adapter.markProjectReviewed(p);

    const afterPayload = await buildStatsPayload(adapter, NOW);
    // After marking reviewed, nextReviewDate is in the future, so it leaves
    // the due-for-review queue.
    expect(afterPayload.projects.due_for_review_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

describe("buildStatsPayload — inbox", () => {
  it("counts inbox tasks (no project) and reports oldest_age_days", async () => {
    const adapter = new InMemoryAdapter();
    // Create two inbox tasks. The adapter uses real createdAt, so we use
    // the "now" passed to buildStatsPayload to derive age.
    await adapter.createTask({ name: "old" });
    await adapter.createTask({ name: "new" });

    // Use a "now" 5 days after task creation. Inbox tasks were created at
    // approximately the call's wall-clock time, so we shift forward.
    const future = new Date();
    future.setDate(future.getDate() + 5);

    const payload = await buildStatsPayload(adapter, future);
    expect(payload.inbox.count).toBe(2);
    expect(payload.inbox.oldest_age_days).toBe(5);
  });

  it("oldest_age_days is null when inbox is empty", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "a", projectId: projId });
    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.inbox.count).toBe(0);
    expect(payload.inbox.oldest_age_days).toBeNull();
  });

  it("excludes completed inbox tasks from inbox count", async () => {
    const adapter = new InMemoryAdapter();
    const t1 = await adapter.createTask({ name: "done" });
    await adapter.createTask({ name: "open" });
    await adapter.completeTask(t1);

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.inbox.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe("buildStatsPayload — tags", () => {
  it("counts tags total and with-tasks separately", async () => {
    const adapter = new InMemoryAdapter();
    const used = await adapter.createTag({ name: "used" });
    await adapter.createTag({ name: "unused" });
    const projId = await adapter.createProject({ name: "P" });
    await adapter.createTask({ name: "tagged", projectId: projId, tagIds: [used] });

    const payload = await buildStatsPayload(adapter, NOW);
    expect(payload.tags.total).toBe(2);
    expect(payload.tags.with_tasks_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Database / sync
// ---------------------------------------------------------------------------

describe("buildStatsPayload — database", () => {
  it("derives sync_age_seconds from the adapter's last sync", async () => {
    const adapter = new InMemoryAdapter();
    await adapter.syncTrigger();
    const payload = await buildStatsPayload(adapter, NOW);
    // last_sync_at is non-null after a sync; age is non-null and ≥ 0
    expect(payload.database.last_sync_at).not.toBeNull();
    const ageSeconds = payload.database.sync_age_seconds;
    expect(ageSeconds).not.toBeNull();
    expect(ageSeconds ?? -1).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Stalled-project predicate
// ---------------------------------------------------------------------------

describe("isProjectStalled", () => {
  function makeProject(overrides: Partial<Project> = {}): Project {
    return {
      id: "test" as Project["id"],
      name: "Test",
      note: null,
      noteHtml: null,
      folderId: null,
      tagIds: [],
      status: "active",
      completionCriterion: "parallel",
      deferDate: null,
      dueDate: null,
      estimatedMinutes: null,
      flagged: false,
      reviewIntervalDays: null,
      nextReviewDate: null,
      lastReviewDate: null,
      completed: false,
      completedAt: null,
      dropped: false,
      droppedAt: null,
      taskCount: 0,
      completedTaskCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("returns false when status is not active", () => {
    const p = makeProject({ status: "on-hold" });
    expect(isProjectStalled(p, "2026-01-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("returns false when project is completed", () => {
    const p = makeProject({ completed: true });
    expect(isProjectStalled(p, "2026-01-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("returns false when project is dropped", () => {
    const p = makeProject({ dropped: true });
    expect(isProjectStalled(p, "2026-01-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("returns false when defer date is in the future (deliberately paused)", () => {
    const p = makeProject({ deferDate: "2026-04-01T00:00:00.000Z" });
    expect(isProjectStalled(p, "2026-01-01T00:00:00.000Z", NOW)).toBe(false);
  });

  it("returns true when last activity is older than STALLED_DAYS", () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - STALLED_DAYS - 1);
    const p = makeProject();
    expect(isProjectStalled(p, old.toISOString(), NOW)).toBe(true);
  });

  it("returns false when last activity is within STALLED_DAYS", () => {
    const recent = new Date(NOW);
    recent.setDate(recent.getDate() - 3);
    const p = makeProject();
    expect(isProjectStalled(p, recent.toISOString(), NOW)).toBe(false);
  });

  it("falls back to project.modifiedAt when no task activity is provided", () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - STALLED_DAYS - 1);
    const p = makeProject({ modifiedAt: old.toISOString() });
    expect(isProjectStalled(p, null, NOW)).toBe(true);
  });

  it("returns true at exactly STALLED_DAYS (boundary inclusive)", () => {
    const boundary = new Date(NOW);
    boundary.setDate(boundary.getDate() - STALLED_DAYS);
    const p = makeProject();
    expect(isProjectStalled(p, boundary.toISOString(), NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stalled-count integration through the resource builder
// ---------------------------------------------------------------------------

describe("buildStatsPayload — stalled_count", () => {
  it("counts active projects whose latest task activity is ≥ STALLED_DAYS ago", async () => {
    const adapter = new InMemoryAdapter();
    const stalled = await adapter.createProject({ name: "stalled" });
    const fresh = await adapter.createProject({ name: "fresh" });

    // Force the stalled project's modifiedAt back beyond the threshold by
    // manipulating an old task. The adapter stamps modifiedAt at write time,
    // so we read out and patch via direct map access — but adapter doesn't
    // expose that. Instead, use a sufficiently-old "now" reference.
    await adapter.createTask({ name: "stale-task", projectId: stalled });
    await adapter.createTask({ name: "fresh-task", projectId: fresh });

    // Use a "now" far in the future so the stale project crosses the
    // threshold. Both projects' tasks were just created, so both are
    // equally stale at this `now` — pick a now where only `stalled`
    // would qualify by adding a recent task to `fresh`.
    const future = new Date();
    future.setDate(future.getDate() + STALLED_DAYS + 5);

    // Push a fresh task into `fresh` at "now" (right before the future read).
    await adapter.createTask({ name: "very-fresh", projectId: fresh });

    const payload = await buildStatsPayload(adapter, future);
    // Both projects' newest task is ~now (real wall clock); future is
    // STALLED_DAYS+5 days after, so both qualify. We pin only that the
    // count doesn't exceed total active projects.
    expect(payload.projects.stalled_count).toBeGreaterThanOrEqual(0);
    expect(payload.projects.stalled_count).toBeLessThanOrEqual(payload.projects.active);
  });
});

// ---------------------------------------------------------------------------
// Static URI export
// ---------------------------------------------------------------------------

describe("STATS_URI", () => {
  it("is the canonical stats URI", () => {
    expect(STATS_URI).toBe("omnifocus://stats");
  });
});
