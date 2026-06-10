/**
 * Webhook event diff (per ADR-0016, #483 slice 2).
 *
 * Pure function: takes a "previous" and "current" snapshot of tasks /
 * projects plus the registered webhooks, returns the list of events to
 * deliver. Has no I/O, no observable side effects, no time dependence;
 * wholly determined by its inputs. The cache-refresh integration in
 * slice 3 calls this each time it has a before/after pair.
 *
 * **Slice 2 scope: types + pure diff.** The cache-refresh hook + actual
 * HTTPS delivery + retry / circuit breaker land in slice 3; the
 * `webhook_test` synthetic-event tool + integration test land in slice 4.
 *
 * @see docs/adr/0016-webhook-delivery.md
 * @see src/webhooks/dispatcher.ts — WebhookDispatcher consumer of these events
 */

import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import type { Webhook, WebhookTrigger } from "./types.js";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * One event produced by the diff. The dispatcher consumes these and
 * delivers them to the registered webhook's URL (slice 3). The shape is
 * the wire format — what the receiver's POST body becomes.
 */
export type WebhookEvent =
  | {
      kind: "task-completed";
      webhookName: string;
      taskId: string;
      taskName: string;
      projectId: string | null;
      tagIds: readonly string[];
      occurredAt: string;
    }
  | {
      kind: "task-created";
      webhookName: string;
      taskId: string;
      taskName: string;
      projectId: string | null;
      tagIds: readonly string[];
      occurredAt: string;
    }
  | {
      kind: "project-status-changed";
      webhookName: string;
      projectId: string;
      projectName: string;
      previousStatus: string;
      currentStatus: string;
      occurredAt: string;
    };

// ---------------------------------------------------------------------------
// Snapshot shape
// ---------------------------------------------------------------------------

/**
 * Minimal task projection used for diff. Includes only the fields the
 * registered triggers can match against — completion, project membership,
 * tags. Cuts memory + comparison cost vs. full Task.
 */
export interface TaskSnapshotEntry {
  id: string;
  name: string;
  completed: boolean;
  projectId: string | null;
  tagIds: readonly string[];
}

/**
 * Minimal project projection used for diff.
 */
export interface ProjectSnapshotEntry {
  id: string;
  name: string;
  status: string;
}

/** Adapt a domain `Task` into the diff projection. */
export function snapshotTask(task: Task): TaskSnapshotEntry {
  return {
    id: String(task.id),
    name: task.name,
    completed: !!task.completed,
    projectId: task.projectId ? String(task.projectId) : null,
    tagIds: task.tagIds.map((id) => String(id)),
  };
}

/** Adapt a domain `Project` into the diff projection. */
export function snapshotProject(project: Project): ProjectSnapshotEntry {
  return {
    id: String(project.id),
    name: project.name,
    status: project.status,
  };
}

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

/** Returns true when the task entry satisfies the webhook trigger's filter. */
function taskMatchesFilter(
  task: TaskSnapshotEntry,
  filter: { tagId?: string; projectId?: string } | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.projectId !== undefined && task.projectId !== filter.projectId) return false;
  if (filter.tagId !== undefined && !task.tagIds.includes(filter.tagId)) return false;
  return true;
}

/** Returns true when the project entry satisfies the webhook trigger's filter. */
function projectMatchesFilter(
  project: ProjectSnapshotEntry,
  filter: { projectId?: string } | undefined,
): boolean {
  if (filter === undefined) return true;
  if (filter.projectId !== undefined && project.id !== filter.projectId) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface DiffOptions {
  /** Reference moment for the `occurredAt` field. Caller-injectable for tests. */
  now?: Date;
}

/**
 * Compute the events to deliver given before/after snapshots and the
 * currently-registered webhooks.
 *
 * Detection rules:
 * - **task-completed** — task exists in both, `completed` flipped from
 *   false → true. (A task that disappears from `current` is deletion, not
 *   completion — ignored here.)
 * - **task-created** — task exists in `current` but not `previous`.
 * - **project-status-changed** — project exists in both, `status`
 *   differs. (Status changing to "completed" / "dropped" both fire — the
 *   trigger is "any status change", not just specific transitions.)
 *
 * Each detection produces one event PER MATCHING REGISTERED WEBHOOK
 * (filter applied), so two webhooks both subscribed to `task-completed`
 * with no filter both receive the same task-completion event. The
 * `webhookName` field on the event lets the dispatcher route it to the
 * right URL in slice 3.
 *
 * Pure: no I/O, no clock reads beyond `opts.now`, deterministic.
 */
export function diffWebhookEvents(
  previous: { tasks: readonly TaskSnapshotEntry[]; projects: readonly ProjectSnapshotEntry[] },
  current: { tasks: readonly TaskSnapshotEntry[]; projects: readonly ProjectSnapshotEntry[] },
  registered: readonly Webhook[],
  opts: DiffOptions = {},
): WebhookEvent[] {
  const occurredAt = (opts.now ?? new Date()).toISOString();
  const out: WebhookEvent[] = [];

  const prevTasks = new Map(previous.tasks.map((t) => [t.id, t]));
  const prevProjects = new Map(previous.projects.map((p) => [p.id, p]));

  // --- task diffs -----------------------------------------------------------
  for (const t of current.tasks) {
    const prev = prevTasks.get(t.id);
    if (prev === undefined) {
      emitMatchingTaskEvents(t, "task-created", registered, occurredAt, out);
      if (t.completed) {
        // First observed already completed: the task was created AND
        // completed within this observation window, so both transitions
        // happened — emit task-completed too, or completion-triggered
        // subscribers would permanently miss it (the next diff sees
        // completed=true on both sides).
        emitMatchingTaskEvents(t, "task-completed", registered, occurredAt, out);
      }
      continue;
    }
    if (!prev.completed && t.completed) {
      emitMatchingTaskEvents(t, "task-completed", registered, occurredAt, out);
    }
  }

  // --- project diffs --------------------------------------------------------
  for (const p of current.projects) {
    const prev = prevProjects.get(p.id);
    if (prev === undefined) continue; // creation is not a project trigger
    if (prev.status !== p.status) {
      for (const w of registered) {
        if (w.trigger.on !== "project-status-changed") continue;
        if (!projectMatchesFilter(p, w.trigger.filter)) continue;
        out.push({
          kind: "project-status-changed",
          webhookName: w.name,
          projectId: p.id,
          projectName: p.name,
          previousStatus: prev.status,
          currentStatus: p.status,
          occurredAt,
        });
      }
    }
  }

  return out;
}

function emitMatchingTaskEvents(
  task: TaskSnapshotEntry,
  kind: "task-completed" | "task-created",
  registered: readonly Webhook[],
  occurredAt: string,
  out: WebhookEvent[],
): void {
  for (const w of registered) {
    if (w.trigger.on !== kind) continue;
    const filter = (w.trigger as Extract<WebhookTrigger, { on: "task-completed" | "task-created" }>)
      .filter;
    if (!taskMatchesFilter(task, filter)) continue;
    out.push({
      kind,
      webhookName: w.name,
      taskId: task.id,
      taskName: task.name,
      projectId: task.projectId,
      tagIds: task.tagIds,
      occurredAt,
    });
  }
}
