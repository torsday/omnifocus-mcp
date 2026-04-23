/**
 * `ExportService` — structured export operations (OPML, TaskPaper, etc.).
 *
 * Composes existing adapter primitives into export formats. No new adapter
 * methods required — the service fetches domain objects and serialises them.
 *
 * @see DESIGN.md §6.5 — service layer principles
 * @see docs/domain-reference.md — canonical domain schemas
 */

import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { FolderId, ProjectId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import { NotFound } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Which slice of the OmniFocus database to export. */
export type ExportScope =
  | { kind: "project"; id: ProjectId }
  | { kind: "folder"; id: FolderId }
  | { kind: "all" };

export interface ExportOpmlResult {
  /** Complete, well-formed OPML XML string. */
  opml: string;
  /** Number of projects included in the export. */
  projectCount: number;
  /** Number of tasks (all levels) included in the export. */
  taskCount: number;
}

// ---------------------------------------------------------------------------
// OPML serialisation helpers
// ---------------------------------------------------------------------------

/** Escape XML special characters in attribute values. */
function xmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build an `<outline>` element for a task, recursively rendering children.
 *
 * Attributes follow OmniFocus's own OPML conventions:
 * - `text` — task name (required by OPML spec)
 * - `type` — `"omnifocus:task"` to allow round-trip import
 * - `id` — persistent OmniFocus ID
 * - `due` — ISO-8601 due date, omitted if null
 * - `defer` — ISO-8601 defer date, omitted if null
 * - `flagged` — `"true"` if flagged, omitted if false
 * - `completed` — `"true"` if completed, omitted if false
 * - `dropped` — `"true"` if dropped, omitted if false
 * - `note` — plain-text note, omitted if null/empty
 */
function renderTaskOutline(
  task: Task,
  childrenByParent: Map<string, Task[]>,
  indent: string,
): string {
  const attrs: string[] = [
    `text="${xmlAttr(task.name)}"`,
    `type="omnifocus:task"`,
    `id="${xmlAttr(String(task.id))}"`,
  ];
  if (task.dueDate) attrs.push(`due="${xmlAttr(task.dueDate)}"`);
  if (task.deferDate) attrs.push(`defer="${xmlAttr(task.deferDate)}"`);
  if (task.flagged) attrs.push(`flagged="true"`);
  if (task.completed) attrs.push(`completed="true"`);
  if (task.dropped) attrs.push(`dropped="true"`);
  if (task.note) attrs.push(`note="${xmlAttr(task.note)}"`);

  const children = childrenByParent.get(String(task.id)) ?? [];
  if (children.length === 0) {
    return `${indent}<outline ${attrs.join(" ")} />`;
  }

  const childIndent = `${indent}  `;
  const childLines = children
    .map((c) => renderTaskOutline(c, childrenByParent, childIndent))
    .join("\n");
  return `${indent}<outline ${attrs.join(" ")}>\n${childLines}\n${indent}</outline>`;
}

/**
 * Build an `<outline>` element for a project with its task tree.
 */
function renderProjectOutline(project: Project, tasks: Task[], indent: string): string {
  // Build parent → children map for tasks in this project
  const byParent = new Map<string, Task[]>();
  const rootTasks: Task[] = [];

  for (const task of tasks) {
    if (task.parentId === null) {
      rootTasks.push(task);
    } else {
      const key = String(task.parentId);
      const existing = byParent.get(key);
      if (existing) {
        existing.push(task);
      } else {
        byParent.set(key, [task]);
      }
    }
  }

  const attrs: string[] = [
    `text="${xmlAttr(project.name)}"`,
    `type="omnifocus:project"`,
    `id="${xmlAttr(String(project.id))}"`,
    `status="${xmlAttr(project.status)}"`,
  ];
  if (project.dueDate) attrs.push(`due="${xmlAttr(project.dueDate)}"`);
  if (project.deferDate) attrs.push(`defer="${xmlAttr(project.deferDate)}"`);
  if (project.flagged) attrs.push(`flagged="true"`);
  if (project.note) attrs.push(`note="${xmlAttr(project.note)}"`);

  const childIndent = `${indent}  `;
  if (rootTasks.length === 0) {
    return `${indent}<outline ${attrs.join(" ")} />`;
  }

  const childLines = rootTasks.map((t) => renderTaskOutline(t, byParent, childIndent)).join("\n");
  return `${indent}<outline ${attrs.join(" ")}>\n${childLines}\n${indent}</outline>`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExportService {
  private readonly adapter: OmniFocusAdapter;

  constructor(deps: { adapter: OmniFocusAdapter }) {
    this.adapter = deps.adapter;
  }

  /**
   * Export OmniFocus data as OPML XML.
   *
   * Scope controls the slice exported:
   * - `{ kind: "project", id }` — one project and its task tree
   * - `{ kind: "folder", id }` — all projects in a folder (flat; no
   *   sub-folder recursion in v1)
   * - `{ kind: "all" }` — all active projects (status = active)
   *
   * The returned OPML is a complete, well-formed XML document following
   * OmniFocus's own OPML conventions so that it can be round-tripped back
   * into OmniFocus via File → Import.
   *
   * @throws {NotFound} when the requested project or folder ID does not exist.
   */
  async exportOpml(scope: ExportScope): Promise<ExportOpmlResult> {
    const projects = await this.resolveProjects(scope);

    // Fetch tasks per project in parallel reads (adapter contract: reads are safe to parallelise)
    const tasksByProject = await Promise.all(
      projects.map((p) =>
        this.adapter.listTasks({ projectId: p.id }).then((tasks) => ({ project: p, tasks })),
      ),
    );

    const projectOutlines = tasksByProject
      .map(({ project, tasks }) => renderProjectOutline(project, tasks, "    "))
      .join("\n");

    const totalTasks = tasksByProject.reduce((sum, { tasks }) => sum + tasks.length, 0);

    const opml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<opml version="2.0">`,
      `  <head>`,
      `    <title>OmniFocus Export</title>`,
      `  </head>`,
      `  <body>`,
      projectOutlines,
      `  </body>`,
      `</opml>`,
    ].join("\n");

    return {
      opml,
      projectCount: projects.length,
      taskCount: totalTasks,
    };
  }

  /** Resolve the correct project list based on scope. */
  private async resolveProjects(scope: ExportScope): Promise<Project[]> {
    if (scope.kind === "all") {
      return this.adapter.listProjects({ status: "active" });
    }
    if (scope.kind === "folder") {
      const projects = await this.adapter.listProjects({ folderId: scope.id });
      // Verify folder existence: if no projects returned, check that the folder
      // actually exists (listProjects returns [] for unknown folderIds too).
      if (projects.length === 0) {
        // Best-effort check — getFolder may not exist on all adapters yet;
        // skip the existence check when the method isn't available.
        try {
          await this.adapter.getFolder(scope.id);
        } catch {
          throw new NotFound(`Folder not found: ${String(scope.id)}`, {
            details: { resource: "folder", id: String(scope.id) },
          });
        }
      }
      return projects;
    }
    // kind === "project"
    const project = await this.adapter.getProject(scope.id);
    return [project];
  }
}
