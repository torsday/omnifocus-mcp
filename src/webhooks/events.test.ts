/**
 * Tests for the pure WebhookEvent diff (slice 2 of #483).
 *
 * Pure-function tests: zero I/O, deterministic, every trigger variant + every
 * filter shape. Slice 3 will exercise the cache-refresh integration end-to-end.
 */

import { describe, expect, it } from "vitest";
import { diffWebhookEvents, type ProjectSnapshotEntry, type TaskSnapshotEntry } from "./events.js";
import type { Webhook } from "./types.js";

const NOW = new Date("2026-04-29T18:00:00.000Z");

function makeWebhook(over: Partial<Webhook> & Pick<Webhook, "trigger">): Webhook {
  return {
    name: "wh",
    url: "https://example.com/x",
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const TASK_OPEN: TaskSnapshotEntry = {
  id: "t1",
  name: "do thing",
  completed: false,
  projectId: "p1",
  tagIds: ["tag-home"],
};
const TASK_DONE: TaskSnapshotEntry = { ...TASK_OPEN, completed: true };
const TASK_ELSE: TaskSnapshotEntry = {
  id: "t2",
  name: "other thing",
  completed: false,
  projectId: "p2",
  tagIds: [],
};

const PROJ_ACTIVE: ProjectSnapshotEntry = { id: "p1", name: "P", status: "active" };
const PROJ_DONE: ProjectSnapshotEntry = { id: "p1", name: "P", status: "completed" };

describe("diffWebhookEvents — task-completed", () => {
  it("emits when a task transitions from open to completed", () => {
    const wh = makeWebhook({ name: "all-completions", trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "task-completed",
      webhookName: "all-completions",
      taskId: "t1",
      taskName: "do thing",
      projectId: "p1",
      occurredAt: NOW.toISOString(),
    });
  });

  it("does NOT emit when a task is already completed in the previous snapshot", () => {
    const wh = makeWebhook({ trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_DONE], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("emits when a task first appears already completed (created+completed in one window)", () => {
    // Agent flows like task_create → task_complete coalesce into a single
    // debounce window: the task shows up in `current` with completed=true
    // and no `previous` entry. The completion signal must not be dropped.
    const wh = makeWebhook({ name: "all-completions", trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "task-completed",
      webhookName: "all-completions",
      taskId: "t1",
    });
  });

  it("emits both task-created and task-completed for a new already-completed task", () => {
    const created = makeWebhook({ name: "creations", trigger: { on: "task-created" } });
    const completed = makeWebhook({ name: "completions", trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [created, completed],
      { now: NOW },
    );
    expect(events.map((e) => [e.kind, e.webhookName])).toEqual([
      ["task-created", "creations"],
      ["task-completed", "completions"],
    ]);
  });

  it("does NOT emit when a task disappears (deletion is not completion)", () => {
    const wh = makeWebhook({ trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("respects the projectId filter", () => {
    const matching = makeWebhook({
      name: "p1-only",
      trigger: { on: "task-completed", filter: { projectId: "p1" } },
    });
    const nonMatching = makeWebhook({
      name: "p2-only",
      trigger: { on: "task-completed", filter: { projectId: "p2" } },
    });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [matching, nonMatching],
      { now: NOW },
    );
    expect(events.map((e) => e.webhookName)).toEqual(["p1-only"]);
  });

  it("respects the tagId filter", () => {
    const matching = makeWebhook({
      name: "home-only",
      trigger: { on: "task-completed", filter: { tagId: "tag-home" } },
    });
    const nonMatching = makeWebhook({
      name: "phone-only",
      trigger: { on: "task-completed", filter: { tagId: "tag-phone" } },
    });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [matching, nonMatching],
      { now: NOW },
    );
    expect(events.map((e) => e.webhookName)).toEqual(["home-only"]);
  });

  it("emits one event per matching webhook", () => {
    const a = makeWebhook({ name: "a", trigger: { on: "task-completed" } });
    const b = makeWebhook({ name: "b", trigger: { on: "task-completed" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [a, b],
      { now: NOW },
    );
    expect(events.map((e) => e.webhookName).sort()).toEqual(["a", "b"]);
  });
});

describe("diffWebhookEvents — task-created", () => {
  it("emits for tasks present in current but not previous", () => {
    const wh = makeWebhook({ trigger: { on: "task-created" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_OPEN, TASK_ELSE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("task-created");
    if (events[0]?.kind === "task-created") {
      expect(events[0].taskId).toBe("t2");
    }
  });

  it("does NOT emit for unchanged tasks", () => {
    const wh = makeWebhook({ trigger: { on: "task-created" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_OPEN], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("respects filters on task-created", () => {
    const wh = makeWebhook({
      trigger: { on: "task-created", filter: { projectId: "p1" } },
    });
    const events = diffWebhookEvents(
      { tasks: [], projects: [] },
      { tasks: [TASK_OPEN, TASK_ELSE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toHaveLength(1);
    if (events[0]?.kind === "task-created") expect(events[0].taskId).toBe("t1");
  });
});

describe("diffWebhookEvents — project-status-changed", () => {
  it("emits when project status differs", () => {
    const wh = makeWebhook({ trigger: { on: "project-status-changed" } });
    const events = diffWebhookEvents(
      { tasks: [], projects: [PROJ_ACTIVE] },
      { tasks: [], projects: [PROJ_DONE] },
      [wh],
      { now: NOW },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "project-status-changed",
      projectId: "p1",
      previousStatus: "active",
      currentStatus: "completed",
    });
  });

  it("does NOT emit for unchanged status", () => {
    const wh = makeWebhook({ trigger: { on: "project-status-changed" } });
    const events = diffWebhookEvents(
      { tasks: [], projects: [PROJ_ACTIVE] },
      { tasks: [], projects: [PROJ_ACTIVE] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("does NOT emit for newly-created projects (creation is not status-change)", () => {
    const wh = makeWebhook({ trigger: { on: "project-status-changed" } });
    const events = diffWebhookEvents(
      { tasks: [], projects: [] },
      { tasks: [], projects: [PROJ_ACTIVE] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("respects projectId filter", () => {
    const matching = makeWebhook({
      name: "p1",
      trigger: { on: "project-status-changed", filter: { projectId: "p1" } },
    });
    const nonMatching = makeWebhook({
      name: "p2",
      trigger: { on: "project-status-changed", filter: { projectId: "other" } },
    });
    const events = diffWebhookEvents(
      { tasks: [], projects: [PROJ_ACTIVE] },
      { tasks: [], projects: [PROJ_DONE] },
      [matching, nonMatching],
      { now: NOW },
    );
    expect(events.map((e) => e.webhookName)).toEqual(["p1"]);
  });
});

describe("diffWebhookEvents — cross-trigger isolation", () => {
  it("a webhook subscribed to task-completed does NOT receive task-created events", () => {
    const completedHook = makeWebhook({
      name: "completions",
      trigger: { on: "task-completed" },
    });
    const events = diffWebhookEvents(
      { tasks: [], projects: [] },
      { tasks: [TASK_OPEN], projects: [] },
      [completedHook],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("project-status webhooks ignore task changes", () => {
    const wh = makeWebhook({ trigger: { on: "project-status-changed" } });
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [wh],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("returns an empty array when no webhooks are registered", () => {
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [PROJ_ACTIVE] },
      { tasks: [TASK_DONE], projects: [PROJ_DONE] },
      [],
      { now: NOW },
    );
    expect(events).toEqual([]);
  });

  it("uses the injected `now` for occurredAt deterministically", () => {
    const wh = makeWebhook({ trigger: { on: "task-completed" } });
    const fixed = new Date("2099-12-31T23:59:59.000Z");
    const events = diffWebhookEvents(
      { tasks: [TASK_OPEN], projects: [] },
      { tasks: [TASK_DONE], projects: [] },
      [wh],
      { now: fixed },
    );
    expect(events[0]?.occurredAt).toBe(fixed.toISOString());
  });
});
