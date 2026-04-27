/**
 * `omnifocus://burndown/{projectId}` MCP resource.
 *
 * Per-project burndown — how much work remains relative to where a naive
 * linear progress model says the project should be given its start date and
 * due date.
 *
 * URI: `omnifocus://burndown/{projectId}`
 *
 * Success payload shape:
 *   {
 *     projectId:        string
 *     name:             string
 *     dueDate:          string     — project due date (ISO-8601)
 *     startDate:        string     — creation date of the earliest task (ISO-8601),
 *                                    or the project createdAt if no tasks exist
 *     totalTasks:       number     — all tasks (completed + remaining)
 *     completedTasks:   number
 *     remainingTasks:   number
 *     idealLinePercent: number     — % complete expected at this moment on a linear schedule
 *     actualPercent:    number     — % actually complete
 *     deltaDays:        number     — positive = ahead of pace; negative = behind
 *     note:             string     — human-readable status summary
 *   }
 *
 * Error response shape (always HTTP-200, typed JSON):
 *   {
 *     error: { code: "ProjectNotFound" | "NoDueDate"; message: string }
 *   }
 *
 * Notes:
 * - "Ideal line" is a naive linear model: (elapsedDays / totalDays) × 100.
 *   The simplification is documented in the payload's `note` field.
 * - `startDate` = creation date of the earliest non-dropped task; falls back
 *   to project `createdAt` when the project has no tasks.
 * - `deltaDays` is the gap between where the ideal line says we should be
 *   and where we actually are, expressed in days of the project timeline.
 *   Computed as: (actualPercent − idealLinePercent) / 100 × totalDays.
 *
 * @see #480
 * @see src/resources/velocity.ts — rolling completion velocity
 * @see src/domain/calendarWeeks.ts — week-boundary helpers (shared)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { ProjectId as ProjectIdType } from "../domain/ids.js";
import { ProjectId as ProjectIdCtor } from "../domain/ids.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BURNDOWN_URI_TEMPLATE = "omnifocus://burndown/{projectId}";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BurndownPayload {
  projectId: string;
  name: string;
  dueDate: string;
  startDate: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  idealLinePercent: number;
  actualPercent: number;
  /** Positive = ahead of pace; negative = behind pace. */
  deltaDays: number;
  note: string;
}

export interface BurndownError {
  error: { code: "ProjectNotFound" | "NoDueDate"; message: string };
}

export type BurndownResult = BurndownPayload | BurndownError;

// ---------------------------------------------------------------------------
// Helpers — pure, exported for testing
// ---------------------------------------------------------------------------

/** Round to two decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the burndown payload for one project.
 *
 * Returns a typed error object when the project is not found or has no due date.
 * Never throws — callers can always serialize the return value directly.
 */
export async function buildBurndownPayload(
  adapter: OmniFocusAdapter,
  projectId: string,
  now: Date = new Date(),
): Promise<BurndownResult> {
  // ── Project lookup ─────────────────────────────────────────────────────
  let pid: ProjectIdType;
  try {
    pid = ProjectIdCtor.of(projectId);
  } catch {
    return {
      error: { code: "ProjectNotFound", message: `Project not found: ${projectId}` },
    };
  }

  const projects = await adapter.listProjects();
  const project = projects.find((p) => String(p.id) === String(pid));
  if (!project) {
    return {
      error: { code: "ProjectNotFound", message: `Project not found: ${projectId}` },
    };
  }

  // ── Due-date guard ─────────────────────────────────────────────────────
  if (!project.dueDate) {
    return {
      error: {
        code: "NoDueDate",
        message: `Project "${project.name}" has no due date — burndown requires a deadline.`,
      },
    };
  }

  // ── Task counts ────────────────────────────────────────────────────────
  // Fetch all tasks in the project (completed + incomplete).
  const [incompleteTasks, completedTasks] = await Promise.all([
    adapter.listTasks({ completed: false }),
    adapter.listTasks({ completed: true }),
  ]);

  const projectIdStr = String(project.id);
  const projectIncomplete = incompleteTasks.filter(
    (t) => !t.dropped && t.projectId !== null && String(t.projectId) === projectIdStr,
  );
  const projectCompleted = completedTasks.filter(
    (t) => t.projectId !== null && String(t.projectId) === projectIdStr,
  );

  const totalTasks = projectIncomplete.length + projectCompleted.length;
  const completedCount = projectCompleted.length;
  const remainingCount = projectIncomplete.length;

  // ── Start date ─────────────────────────────────────────────────────────
  // Earliest task createdAt; fall back to project createdAt.
  const allTasks = [...projectIncomplete, ...projectCompleted];
  const firstTask = allTasks[0];
  const startDate =
    allTasks.length > 0 && firstTask !== undefined
      ? allTasks.reduce(
          (earliest, t) => (t.createdAt < earliest ? t.createdAt : earliest),
          firstTask.createdAt,
        )
      : project.createdAt;

  // ── Burndown math ──────────────────────────────────────────────────────
  const startMs = new Date(startDate).getTime();
  const dueMs = new Date(project.dueDate).getTime();
  const nowMs = now.getTime();

  const totalDays = Math.max(1, (dueMs - startMs) / 86_400_000);

  // Clamp elapsed to [0, totalDays] — project may be overdue or not started yet.
  const elapsedDays = Math.max(0, Math.min(totalDays, (nowMs - startMs) / 86_400_000));

  const idealLinePercent = round2((elapsedDays / totalDays) * 100);
  const actualPercent = totalTasks === 0 ? 100 : round2((completedCount / totalTasks) * 100);

  // deltaDays: positive = ahead, negative = behind
  const deltaDays = round2(((actualPercent - idealLinePercent) / 100) * totalDays);

  // ── Human-readable status ──────────────────────────────────────────────
  let note: string;
  if (totalTasks === 0) {
    note = "No tasks in project — burndown is trivially complete.";
  } else if (deltaDays > 0) {
    note = `Ahead of pace by ${deltaDays.toFixed(1)} day(s). Ideal: ${idealLinePercent.toFixed(1)}% done; actual: ${actualPercent.toFixed(1)}%.`;
  } else if (deltaDays < 0) {
    note = `Behind pace by ${Math.abs(deltaDays).toFixed(1)} day(s). Ideal: ${idealLinePercent.toFixed(1)}% done; actual: ${actualPercent.toFixed(1)}%.`;
  } else {
    note = `On pace. Ideal: ${idealLinePercent.toFixed(1)}%; actual: ${actualPercent.toFixed(1)}%.`;
  }

  // Append simplification caveat.
  note +=
    " (Ideal line is naive linear from earliest-task creation to project due date. " +
    "Task weights and blockers are not modelled.)";

  return {
    projectId: projectIdStr,
    name: project.name,
    dueDate: project.dueDate,
    startDate,
    totalTasks,
    completedTasks: completedCount,
    remainingTasks: remainingCount,
    idealLinePercent,
    actualPercent,
    deltaDays,
    note,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBurndownResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-burndown",
    new ResourceTemplate(BURNDOWN_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Per-project burndown chart data — remaining vs completed tasks against a naive linear ideal line. " +
        "Returns totalTasks, completedTasks, remainingTasks, idealLinePercent, actualPercent, and deltaDays " +
        "(positive = ahead of pace; negative = behind). " +
        "Requires the project to have a due date; returns a typed NoDueDate error otherwise. " +
        "Returns ProjectNotFound when the projectId is unknown. " +
        "Ideal line is a linear model from earliest-task creation to due date — task weights and blockers are not modelled. " +
        "Pairs with omnifocus://velocity for macro-level and omnifocus://retrospective for qualitative review. " +
        "Read-only.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const projectId = vars.projectId ?? "";

      const payload = await buildBurndownPayload(adapter, projectId);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
