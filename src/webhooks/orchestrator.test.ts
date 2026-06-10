/**
 * Tests for WebhookOrchestrator (slice 4 of #483).
 *
 * Covers the diff/dispatch composition: first observation seeds without
 * firing, subsequent observations diff and dispatch, no-op when registry
 * is empty. Plus the synthetic-event firing path that backs `webhook_test`.
 */

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import type { WebhookDispatcher } from "./dispatcher.js";
import type { WebhookEvent } from "./events.js";
import { WebhookOrchestrator } from "./orchestrator.js";
import { WebhookRegistry } from "./registry.js";
import type { Webhook } from "./types.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function tmpFile(): string {
  return path.join(
    tmpdir(),
    `omnifocus-mcp-webhooks-orch-test-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`,
  );
}

class CapturingDispatcher implements WebhookDispatcher {
  delivered: Array<{ event: WebhookEvent; webhook: Webhook | undefined }> = [];
  async deliver(event: WebhookEvent, lookup: (name: string) => Webhook | undefined): Promise<void> {
    this.delivered.push({ event, webhook: lookup(event.webhookName) });
  }
}

function makeTask(over: Record<string, unknown> = {}): Task {
  return {
    id: "t1",
    name: "test",
    note: null,
    noteHtml: null,
    projectId: "p1",
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
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as unknown as Task;
}

function makeProject(over: Record<string, unknown> = {}): Project {
  return {
    id: "p1",
    name: "P",
    status: "active",
    note: null,
    noteHtml: null,
    folderId: null,
    tagIds: [],
    completionCriterion: "parallel",
    deferDate: null,
    dueDate: null,
    estimatedMinutes: null,
    flagged: false,
    nextReviewDate: null,
    lastReviewDate: null,
    reviewIntervalDays: null,
    completed: false,
    completedAt: null,
    dropped: false,
    droppedAt: null,
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as unknown as Project;
}

describe("WebhookOrchestrator — shouldObserve", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("returns false when the registry is empty (cache hook can skip its fetch)", () => {
    const registry = new WebhookRegistry({ filePath });
    const orch = new WebhookOrchestrator({ registry, dispatcher: new CapturingDispatcher() });
    expect(orch.shouldObserve()).toBe(false);
  });

  it("returns true once any webhook is registered", () => {
    const registry = new WebhookRegistry({ filePath });
    const orch = new WebhookOrchestrator({ registry, dispatcher: new CapturingDispatcher() });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    expect(orch.shouldObserve()).toBe(true);
  });

  it("flips back to false when the only webhook is deleted", () => {
    const registry = new WebhookRegistry({ filePath });
    const orch = new WebhookOrchestrator({ registry, dispatcher: new CapturingDispatcher() });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    expect(orch.shouldObserve()).toBe(true);
    registry.delete("wh");
    expect(orch.shouldObserve()).toBe(false);
  });
});

describe("WebhookOrchestrator — enabled gate (OMNIFOCUS_WEBHOOKS_ENABLED)", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("shouldObserve returns false when disabled, even with webhooks registered", () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const orch = new WebhookOrchestrator({
      registry,
      dispatcher: new CapturingDispatcher(),
      enabled: false,
    });
    expect(orch.shouldObserve()).toBe(false);
  });

  it("observeSnapshot never dispatches when disabled — persisted webhooks stay silent", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher, enabled: false });

    await orch.observeSnapshot([makeTask({ id: "t1", completed: false })], []);
    await orch.observeSnapshot([makeTask({ id: "t1", completed: true })], []);

    expect(dispatcher.delivered).toEqual([]);
  });

  it("defaults to enabled when the option is omitted (existing wiring unchanged)", () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const orch = new WebhookOrchestrator({ registry, dispatcher: new CapturingDispatcher() });
    expect(orch.shouldObserve()).toBe(true);
  });
});

describe("WebhookOrchestrator — observeSnapshot", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("first observation seeds the baseline without firing events", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    await orch.observeSnapshot([makeTask({ id: "t1", completed: true })], []);
    expect(dispatcher.delivered).toEqual([]);
  });

  it("second observation diffs against the first and dispatches matching events", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    const open = makeTask({ id: "t1", completed: false });
    const done = makeTask({ id: "t1", completed: true });

    await orch.observeSnapshot([open], []); // seed
    await orch.observeSnapshot([done], []); // diff → fire

    expect(dispatcher.delivered).toHaveLength(1);
    expect(dispatcher.delivered[0]?.event.kind).toBe("task-completed");
  });

  it("dispatcher receives the registered webhook via the lookup callback (full record, not summary)", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://internal.example.com/secret-path",
      trigger: { on: "task-completed" },
      secret: "shh-secret-12345",
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    await orch.observeSnapshot([makeTask({ completed: false })], []);
    await orch.observeSnapshot([makeTask({ completed: true })], []);

    expect(dispatcher.delivered).toHaveLength(1);
    expect(dispatcher.delivered[0]?.webhook?.url).toBe("https://internal.example.com/secret-path");
    expect(dispatcher.delivered[0]?.webhook?.secret).toBe("shh-secret-12345");
  });

  it("no-op fast path when registry is empty (still updates last-seen)", async () => {
    const registry = new WebhookRegistry({ filePath });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    await orch.observeSnapshot([makeTask({ completed: false })], []);
    await orch.observeSnapshot([makeTask({ completed: true })], []);
    expect(dispatcher.delivered).toEqual([]);

    // Now register a hook and observe a third time. Because the orchestrator
    // updated last-seen on the no-op path, the third observation diffs
    // against the second (both have completed=true) so no events fire —
    // even with a hook now registered. This protects against re-firing
    // historic completions when a hook is added.
    registry.register({
      name: "late",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    await orch.observeSnapshot([makeTask({ completed: true })], []);
    expect(dispatcher.delivered).toEqual([]);
  });

  it("project-status-changed events flow through the orchestrator", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "wh",
      url: "https://example.com/x",
      trigger: { on: "project-status-changed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    await orch.observeSnapshot([], [makeProject({ id: "p1", status: "active" })]);
    await orch.observeSnapshot([], [makeProject({ id: "p1", status: "done" })]);

    expect(dispatcher.delivered).toHaveLength(1);
    expect(dispatcher.delivered[0]?.event.kind).toBe("project-status-changed");
  });
});

describe("WebhookOrchestrator — fireSynthetic", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("returns { delivered: true } when the named webhook exists", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "exists",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    const result = await orch.fireSynthetic("exists");
    expect(result).toEqual({ delivered: true });
  });

  it("returns { error } when the named webhook does not exist", async () => {
    const registry = new WebhookRegistry({ filePath });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    const result = await orch.fireSynthetic("nope");
    expect(result).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("dispatches the synthetic event with kind matching the registered trigger", async () => {
    const registry = new WebhookRegistry({ filePath });
    registry.register({
      name: "task-created-hook",
      url: "https://example.com/x",
      trigger: { on: "task-created" },
    });
    registry.register({
      name: "project-status-hook",
      url: "https://example.com/y",
      trigger: { on: "project-status-changed" },
    });
    const dispatcher = new CapturingDispatcher();
    const orch = new WebhookOrchestrator({ registry, dispatcher });

    await orch.fireSynthetic("task-created-hook");
    await orch.fireSynthetic("project-status-hook");

    expect(dispatcher.delivered.map((d) => d.event.kind)).toEqual([
      "task-created",
      "project-status-changed",
    ]);
  });
});
