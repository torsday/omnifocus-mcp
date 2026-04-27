/**
 * Domain-level health predicates and thresholds for OmniFocus projects.
 *
 * Single source of truth for "what does it mean for a project to be stalled?"
 * and other health concepts that more than one resource consumes. Resources
 * (e.g. `omnifocus://stats`, `omnifocus://project-health`) MUST import these
 * predicates rather than redefining them — drift between two definitions of
 * "stalled" is a bug class we don't want to chase.
 *
 * @see DESIGN.md §28 — "Stalled-project definition"
 */

import type { Project } from "./project.js";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Days since last task activity at which an active project is considered
 * stalled. Used by `omnifocus://stats` (count form) and
 * `omnifocus://project-health` (list form). The latter exposes this via an
 * optional `staleDays` query parameter so callers can override per-call.
 */
export const STALLED_DAYS = 14;

// ---------------------------------------------------------------------------
// Stalled-project predicate
// ---------------------------------------------------------------------------

/**
 * A project is stalled when ALL of:
 *   1. status === "active" (and not completed or dropped)
 *   2. ≥ `staleDays` days since the latest task activity
 *      (`max(task.modifiedAt)` over the project's tasks, or the project's
 *      own `modifiedAt` if it has no tasks)
 *   3. no defer date in the future — a deferred-into-the-future project is
 *      deliberately paused, not stalled
 *
 * `latestActivityAt` is `null` when the project has no tasks; the caller
 * passes `null` and the project's own `modifiedAt` is the fallback reference.
 */
export function isProjectStalled(
  project: Project,
  latestActivityAt: string | null,
  now: Date,
  staleDays: number = STALLED_DAYS,
): boolean {
  if (project.status !== "active") return false;
  if (project.completed || project.dropped) return false;

  // Deferred-into-the-future projects are deliberately paused, not stalled.
  if (project.deferDate) {
    const deferAt = new Date(project.deferDate);
    if (deferAt.getTime() > now.getTime()) return false;
  }

  const referenceIso = latestActivityAt ?? project.modifiedAt;
  const referenceMs = new Date(referenceIso).getTime();
  const ageMs = now.getTime() - referenceMs;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  return ageDays >= staleDays;
}
