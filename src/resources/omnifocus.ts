/**
 * OmniFocus MCP data resources — all nine URIs from DESIGN §28.
 *
 * Resources are read-only, URI-addressable, enumerable via `resources/list`.
 * They let an agent load structured context without spending a tool call.
 *
 * Static URIs:
 *   omnifocus://snapshot       — orientation object with counts + sync status
 *   omnifocus://inbox          — inbox tasks as Task[]
 *   omnifocus://forecast/today — today's forecast grouped by category
 *   omnifocus://overdue        — overdue tasks sorted by dueDate ASC
 *   omnifocus://flagged        — all flagged available tasks
 *   omnifocus://review-due     — projects with nextReviewDate ≤ today
 *
 * Dynamic URIs (ResourceTemplate):
 *   omnifocus://project/{id}      — single project + full task tree
 *   omnifocus://tag/{id}          — single tag + its tasks
 *   omnifocus://perspective/{id}  — perspective evaluation result
 *
 * Every resource returns `application/json` and carries the equivalent
 * tool's `data` payload directly (no envelope wrapper, per §28 AC2).
 *
 * Cache invalidation follows the same scope matrix as tools (ADR-0006):
 * where a service exists, resource handlers delegate to it so write-side
 * invalidation paths apply automatically.
 *
 * @see DESIGN.md §28 — MCP resources spec
 * @see src/resources/capabilities.ts — omnifocus://capabilities resource
 * @see docs/adr/0006-read-cache-strategy.md
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { ProjectId, TagId } from "../domain/ids.js";
import type { BuiltinPerspectiveId } from "../domain/perspective.js";
import type { ForecastService } from "../services/forecastService.js";
import type { PerspectiveService } from "../services/perspectiveService.js";
import type { ProjectService } from "../services/projectService.js";
import type { ReviewService } from "../services/reviewService.js";

// ---------------------------------------------------------------------------
// Dependency bundle
// ---------------------------------------------------------------------------

/** Services and adapter required to serve the nine data resources. */
export interface OmniFocusResourceDeps {
  /** Raw adapter — used for queries that have no dedicated service (inbox, overdue, flagged, tag). */
  adapter: OmniFocusAdapter;
  projectService: ProjectService;
  reviewService: ReviewService;
  forecastService: ForecastService;
  perspectiveService: PerspectiveService;
}

// ---------------------------------------------------------------------------
// URI constants
// ---------------------------------------------------------------------------

export const SNAPSHOT_URI = "omnifocus://snapshot";
export const INBOX_URI = "omnifocus://inbox";
export const FORECAST_TODAY_URI = "omnifocus://forecast/today";
export const OVERDUE_URI = "omnifocus://overdue";
export const FLAGGED_URI = "omnifocus://flagged";
export const REVIEW_DUE_URI = "omnifocus://review-due";
export const PROJECT_URI_TEMPLATE = "omnifocus://project/{id}";
export const TAG_URI_TEMPLATE = "omnifocus://tag/{id}";
export const PERSPECTIVE_URI_TEMPLATE = "omnifocus://perspective/{id}";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO-8601 strings for start and end of today (local time). */
function todayRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Wrap a JSON payload in the MCP resource contents envelope. */
function jsonContents(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all nine OmniFocus data resources with the given McpServer.
 *
 * Each resource handler delegates to the relevant service or adapter method.
 * No business logic lives here — the service / adapter layer owns filtering,
 * caching, and validation (DESIGN §26 / ADR-0006).
 */
export function registerOmniFocusResources(server: McpServer, deps: OmniFocusResourceDeps): void {
  const { adapter, projectService, reviewService, forecastService, perspectiveService } = deps;

  // ── omnifocus://snapshot ─────────────────────────────────────────────────
  server.registerResource(
    "omnifocus-snapshot",
    SNAPSHOT_URI,
    {
      description:
        "Orientation snapshot of the current OmniFocus state: " +
        "inboxCount, overdueCount, dueTodayCount, flaggedCount, reviewDueCount, " +
        "and syncStatus { lastSyncAt, inFlight }. " +
        "Read at session start to orient before calling task_list or forecast_get. " +
        "Use syncStatus.lastSyncAt to detect stale data before making decisions.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const { from, to } = todayRange();
      const [inboxTasks, forecast, reviewProjects, syncStatus] = await Promise.all([
        adapter.listTasks({ completed: false }),
        adapter.getForecast({ from, to, includeOverdue: true, includeFlagged: true }),
        adapter.listProjectsDueForReview(),
        adapter.getLastSync(),
      ]);

      const inboxCount = inboxTasks.filter(
        (t) => t.projectId === null && t.parentId === null,
      ).length;

      return jsonContents(SNAPSHOT_URI, {
        inboxCount,
        overdueCount: forecast.overdue.length,
        dueTodayCount: forecast.dueToday.length,
        flaggedCount: forecast.flagged.length,
        reviewDueCount: reviewProjects.length,
        syncStatus: {
          lastSyncAt: syncStatus.lastSyncAt,
          inFlight: syncStatus.inFlight,
        },
      });
    },
  );

  // ── omnifocus://inbox ────────────────────────────────────────────────────
  server.registerResource(
    "omnifocus-inbox",
    INBOX_URI,
    {
      description:
        "Inbox tasks as Task[]. Incomplete tasks not assigned to any project or parent task. " +
        "Use to triage the inbox without calling task_list.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const tasks = await adapter.listTasks({ completed: false });
      const inbox = tasks.filter((t) => t.projectId === null && t.parentId === null);
      return jsonContents(INBOX_URI, inbox);
    },
  );

  // ── omnifocus://forecast/today ───────────────────────────────────────────
  server.registerResource(
    "omnifocus-forecast-today",
    FORECAST_TODAY_URI,
    {
      description:
        "Today's forecast tasks grouped by category: overdue[], dueToday[], deferredToday[], flagged[]. " +
        "Equivalent to forecast_get with from/to=today. " +
        "Use for 'what's on my plate today' without a tool call.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const { from, to } = todayRange();
      const result = await forecastService.get({ from, to });
      return jsonContents(FORECAST_TODAY_URI, {
        overdue: result.overdue,
        dueToday: result.dueToday,
        deferredToday: result.deferredToday,
        flagged: result.flagged,
      });
    },
  );

  // ── omnifocus://overdue ──────────────────────────────────────────────────
  server.registerResource(
    "omnifocus-overdue",
    OVERDUE_URI,
    {
      description:
        "All overdue tasks as Task[], sorted by dueDate ascending. " +
        "Tasks whose dueDate is in the past and are not completed/dropped.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const { from } = todayRange();
      const result = await adapter.getForecast({
        from,
        to: from,
        includeOverdue: true,
        includeFlagged: false,
        includeDeferred: false,
      });
      const sorted = [...result.overdue].sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      });
      return jsonContents(OVERDUE_URI, sorted);
    },
  );

  // ── omnifocus://flagged ──────────────────────────────────────────────────
  server.registerResource(
    "omnifocus-flagged",
    FLAGGED_URI,
    {
      description:
        "All flagged available tasks as Task[]. " +
        "Equivalent to task_list with flagged=true. " +
        "Use to review the flagged list without a tool call.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const tasks = await adapter.listTasks({ flagged: true, completed: false });
      return jsonContents(FLAGGED_URI, tasks);
    },
  );

  // ── omnifocus://review-due ───────────────────────────────────────────────
  server.registerResource(
    "omnifocus-review-due",
    REVIEW_DUE_URI,
    {
      description:
        "Projects due for review as Project[], sorted by nextReviewDate ascending. " +
        "Equivalent to review_list_due. " +
        "Use to start a review session without a tool call.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const result = await reviewService.listDue();
      const sorted = [...result.projects].sort((a, b) => {
        if (!a.nextReviewDate) return 1;
        if (!b.nextReviewDate) return -1;
        return a.nextReviewDate < b.nextReviewDate
          ? -1
          : a.nextReviewDate > b.nextReviewDate
            ? 1
            : 0;
      });
      return jsonContents(REVIEW_DUE_URI, sorted);
    },
  );

  // ── omnifocus://project/{id} ─────────────────────────────────────────────
  server.registerResource(
    "omnifocus-project",
    new ResourceTemplate(PROJECT_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Single project with its full task tree as { project: Project, tasks: Task[] }. " +
        "Get the project ID from project_list. " +
        "Tasks are a flat array; rebuild the tree via task.parentId.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const id = ProjectId.of((variables as { id: string }).id);
      const result = await projectService.get({ id, includeTaskTree: true });
      return jsonContents(`omnifocus://project/${id}`, {
        project: result.project,
        tasks: result.tasks ?? [],
      });
    },
  );

  // ── omnifocus://tag/{id} ─────────────────────────────────────────────────
  server.registerResource(
    "omnifocus-tag",
    new ResourceTemplate(TAG_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Single tag with its tasks as { tag: Tag, tasks: Task[] }. " +
        "Get the tag ID from tag_list.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const id = TagId.of((variables as { id: string }).id);
      const [tag, tasks] = await Promise.all([
        adapter.getTag(id),
        adapter.listTasks({ tagId: id, completed: false }),
      ]);
      return jsonContents(`omnifocus://tag/${id}`, { tag, tasks });
    },
  );

  // ── omnifocus://perspective/{id} ─────────────────────────────────────────
  server.registerResource(
    "omnifocus-perspective",
    new ResourceTemplate(PERSPECTIVE_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Perspective evaluation result as { perspectiveId: string, tasks: Task[] }. " +
        "Get perspective IDs from perspective_list. " +
        "Built-in IDs: inbox, projects, tags, forecast, flagged, nearby, review.",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const id = (variables as { id: string }).id as BuiltinPerspectiveId;
      const result = await perspectiveService.evaluate(id);
      return jsonContents(`omnifocus://perspective/${id}`, {
        perspectiveId: id,
        tasks: result.tasks,
      });
    },
  );
}
