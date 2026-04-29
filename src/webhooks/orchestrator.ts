/**
 * WebhookOrchestrator — composes the webhook subsystem (per ADR-0016, #483 slice 4).
 *
 * Owns the registry, the dispatcher, and the "last-seen snapshot" state.
 * Exposes:
 *
 *   - `observeSnapshot(tasks, projects)` — the cache-refresh hook calls this
 *     each time it has a fresh view; the orchestrator diffs against the
 *     previous snapshot and dispatches matching events.
 *   - `fireSynthetic(event)` — backs the `webhook_test` tool: hand-crafts an
 *     event and dispatches it through the same path as a real one.
 *
 * **Slice 4 scope: orchestration + synthetic firing.** The cache-wrapper
 * that calls `observeSnapshot` is a separate follow-up issue — see the
 * close-out comment on #483.
 */

import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import type { WebhookDispatcher } from "./dispatcher.js";
import type { ProjectSnapshotEntry, TaskSnapshotEntry, WebhookEvent } from "./events.js";
import { diffWebhookEvents, snapshotProject, snapshotTask } from "./events.js";
import type { WebhookRegistry } from "./registry.js";

export interface WebhookOrchestratorOptions {
  registry: WebhookRegistry;
  dispatcher: WebhookDispatcher;
  /** Inject `now` for tests. */
  now?: () => Date;
}

export class WebhookOrchestrator {
  private readonly registry: WebhookRegistry;
  private readonly dispatcher: WebhookDispatcher;
  private readonly now: () => Date;
  private lastTasks: readonly TaskSnapshotEntry[] = [];
  private lastProjects: readonly ProjectSnapshotEntry[] = [];
  private hasSeenInitialSnapshot = false;

  constructor(options: WebhookOrchestratorOptions) {
    this.registry = options.registry;
    this.dispatcher = options.dispatcher;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * True iff at least one webhook is currently registered. The
   * cache-observation hook calls this *before* fetching a fresh full
   * snapshot — when no hooks are registered the snapshot fetch would be
   * pure overhead, since `observeSnapshot` would no-op anyway. Cheap:
   * peeks the in-memory registry view, no I/O.
   */
  shouldObserve(): boolean {
    return this.registry.listFull().length > 0;
  }

  /**
   * Feed a fresh snapshot of tasks + projects. The first call seeds the
   * baseline (no events fire — the orchestrator can't tell what was
   * "previous" before it had a starting point); every subsequent call
   * diffs against the prior snapshot and dispatches matching events.
   *
   * Never throws — dispatcher errors are caught and logged inside the
   * dispatcher per ADR-0016 §4e.
   */
  async observeSnapshot(tasks: readonly Task[], projects: readonly Project[]): Promise<void> {
    const taskSnap = tasks.map(snapshotTask);
    const projSnap = projects.map(snapshotProject);

    if (!this.hasSeenInitialSnapshot) {
      this.lastTasks = taskSnap;
      this.lastProjects = projSnap;
      this.hasSeenInitialSnapshot = true;
      return;
    }

    // Reload registry view per call — registrations can change between
    // observations and we want every observation to see the live set.
    const registered = this.registry.listFull();
    if (registered.length === 0) {
      // No-op fast path; still update last-seen so the diff stays correct
      // when a webhook is registered later.
      this.lastTasks = taskSnap;
      this.lastProjects = projSnap;
      return;
    }

    const events = diffWebhookEvents(
      { tasks: this.lastTasks, projects: this.lastProjects },
      { tasks: taskSnap, projects: projSnap },
      registered,
      { now: this.now() },
    );

    this.lastTasks = taskSnap;
    this.lastProjects = projSnap;

    // Dispatch — each delivery resolves regardless of outcome (per
    // ADR-0016 §4e, the dispatcher catches everything internally).
    await Promise.all(
      events.map((e) => this.dispatcher.deliver(e, (name) => this.lookupForDispatch(name))),
    );
  }

  /**
   * Fire a synthetic event for one registered webhook. Backs `webhook_test`.
   * The event content is hand-crafted from the registered trigger so the
   * receiver sees the same shape it would for a real state change.
   */
  async fireSynthetic(webhookName: string): Promise<{ delivered: true } | { error: string }> {
    const target = this.registry.listFull().find((w) => w.name === webhookName);
    if (target === undefined) {
      return { error: `webhook not found: ${webhookName}` };
    }

    const occurredAt = this.now().toISOString();
    const event: WebhookEvent =
      target.trigger.on === "project-status-changed"
        ? {
            kind: "project-status-changed",
            webhookName: target.name,
            projectId: "synthetic-project",
            projectName: "Synthetic test event",
            previousStatus: "active",
            currentStatus: "completed",
            occurredAt,
          }
        : {
            kind: target.trigger.on,
            webhookName: target.name,
            taskId: "synthetic-task",
            taskName: "Synthetic test event",
            projectId: null,
            tagIds: [],
            occurredAt,
          };

    await this.dispatcher.deliver(event, (name) => this.lookupForDispatch(name));
    return { delivered: true };
  }

  private lookupForDispatch(name: string) {
    return this.registry.listFull().find((w) => w.name === name);
  }
}
