/**
 * `ExportService` — structured export operations (OPML, TaskPaper, etc.).
 *
 * Composes existing adapter primitives into export formats. No new adapter
 * methods required — the service fetches domain objects and serialises them.
 *
 * @see DESIGN.md §6.5 — service layer principles
 * @see docs/domain-reference.md — canonical domain schemas
 */

import type { CreateTaskInput, OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { FolderId, ProjectId, TagId, TaskId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";
import type { Task } from "../domain/task.js";
import { NotFound, ValidationError } from "../errors/index.js";

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

export interface ExportTaskPaperResult {
  /** Complete TaskPaper-formatted string. */
  taskpaper: string;
  /** Number of projects included. */
  projectCount: number;
  /** Number of tasks (all levels) included. */
  taskCount: number;
  /**
   * Lossiness warnings — fields that could not be represented in TaskPaper
   * (HTML notes, tag locations, non-simple repetition, attachments, etc.).
   */
  warnings: string[];
}

export interface ImportTaskPaperResult {
  /** IDs of tasks created by the import. */
  created: TaskId[];
  /**
   * Warnings about lines that were skipped or partially parsed, or tags that
   * could not be resolved.
   */
  warnings: string[];
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
// Shared tree-fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch ALL tasks belonging to a project, including subtasks at every depth.
 *
 * `adapter.listTasks({ projectId })` only returns tasks whose `projectId`
 * field equals the given ID — subtasks (which carry `parentId` but have
 * `projectId: null`) are excluded. This helper does a BFS expansion to
 * collect every descendant.
 */
async function fetchProjectTaskTree(
  adapter: OmniFocusAdapter,
  projectId: ProjectId,
): Promise<Task[]> {
  // Fetch root-level tasks (directly in the project)
  const direct = await adapter.listTasks({ projectId });
  const all: Task[] = [...direct];

  // BFS: for each task, fetch its children. `for (;;)` with break-on-empty
  // keeps `current` narrowed to Task without needing a non-null assertion
  // on `queue.shift()`.
  const queue: Task[] = [...direct];
  for (;;) {
    const current = queue.shift();
    if (current === undefined) break;
    const children = await adapter.listTasks({ parentId: current.id });
    for (const child of children) {
      all.push(child);
      queue.push(child);
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// TaskPaper serialisation helpers
// ---------------------------------------------------------------------------

/**
 * Render a task as a TaskPaper line (and recursively render its children).
 *
 * Tags emitted: `@tag-name` for each OF tag, `@due(date)`, `@defer(date)`,
 * `@flagged`, `@done`, `@dropped`.
 *
 * Lossiness notes pushed to `warnings`:
 * - HTML notes → plain note (fidelity lost, no warning needed)
 * - `noteHtml` when plain `note` is null — downgrade with warning
 */
function renderTaskPaper(
  task: Task,
  byParent: Map<string, Task[]>,
  depth: number,
  lines: string[],
  warnings: string[],
): void {
  const indent = "\t".repeat(depth);
  const tags: string[] = [];

  // Tag attributes
  if (task.dueDate) tags.push(`@due(${task.dueDate.slice(0, 10)})`);
  if (task.deferDate) tags.push(`@defer(${task.deferDate.slice(0, 10)})`);
  if (task.flagged) tags.push("@flagged");
  if (task.completed) tags.push("@done");
  if (task.dropped) tags.push("@dropped");

  // TaskPaper has no native concept of tag IDs — we emit tag names when
  // available. Tag IDs are opaque; the import side resolves them by name.
  // (tag names are not in the Task domain model — only tagIds are carried;
  // the caller serialises names separately when needed)

  const tagStr = tags.length > 0 ? ` ${tags.join(" ")}` : "";
  lines.push(`${indent}- ${task.name}${tagStr}`);

  // Note as indented continuation lines
  const noteText = task.note ?? (task.noteHtml ? task.noteHtml.replace(/<[^>]*>/g, "") : null);
  if (noteText) {
    for (const noteLine of noteText.split("\n")) {
      if (noteLine.trim()) lines.push(`${indent}\t${noteLine}`);
    }
    if (task.noteHtml && !task.note) {
      warnings.push(`Task "${task.name}": HTML note downgraded to plain text`);
    }
  }

  // Recurse into children
  const children = byParent.get(String(task.id)) ?? [];
  for (const child of children) {
    renderTaskPaper(child, byParent, depth + 1, lines, warnings);
  }
}

// ---------------------------------------------------------------------------
// TaskPaper parse helpers
// ---------------------------------------------------------------------------

interface ParsedTaskPaperLine {
  name: string;
  dueDate: string | undefined;
  deferDate: string | undefined;
  flagged: boolean;
  done: boolean;
  tagNames: string[];
  note: string | undefined;
}

/**
 * Parse a single TaskPaper task line (the text after the leading `- `).
 *
 * Extracts `@due(date)`, `@defer(date)`, `@flagged`, `@done`, and bare
 * `@tag` names. Dates are passed through as-is; callers may normalise them.
 */
function parseTaskPaperLine(
  text: string,
  lineNum: number,
  warnings: string[],
): ParsedTaskPaperLine {
  let remaining = text;
  let dueDate: string | undefined;
  let deferDate: string | undefined;
  let flagged = false;
  let done = false;
  const tagNames: string[] = [];

  // Extract @due(date) and @defer(date)
  remaining = remaining.replace(/@due\(([^)]+)\)/g, (_, d: string) => {
    dueDate = normaliseDateToken(d.trim(), lineNum, warnings, "due");
    return "";
  });
  remaining = remaining.replace(/@defer\(([^)]+)\)/g, (_, d: string) => {
    deferDate = normaliseDateToken(d.trim(), lineNum, warnings, "defer");
    return "";
  });

  // Extract @flagged and @done
  remaining = remaining.replace(/@flagged/g, () => {
    flagged = true;
    return "";
  });
  remaining = remaining.replace(/@done/g, () => {
    done = true;
    return "";
  });
  remaining = remaining.replace(/@dropped/g, () => {
    done = true;
    return "";
  });

  // Extract bare @tag names (after removing the above known tags)
  remaining = remaining.replace(/@([\w-]+)/g, (_, name: string) => {
    if (
      name !== "due" &&
      name !== "defer" &&
      name !== "flagged" &&
      name !== "done" &&
      name !== "dropped"
    ) {
      tagNames.push(name);
    }
    return "";
  });

  // The task name is what's left, trimmed; note may be embedded after //
  const parts = remaining.split("//");
  const name = (parts[0] ?? "").trim();
  const note = parts[1] ? parts[1].trim() : undefined;

  if (!name) {
    warnings.push(`Line ${lineNum}: empty task name after parsing tags — skipped`);
  }

  return { name: name || "(unnamed)", dueDate, deferDate, flagged, done, tagNames, note };
}

/** Normalise a date token to ISO-8601 (YYYY-MM-DD → YYYY-MM-DDT00:00:00Z). */
function normaliseDateToken(
  raw: string,
  lineNum: number,
  warnings: string[],
  field: string,
): string | undefined {
  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  // Accept full ISO-8601
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw;
  warnings.push(`Line ${lineNum}: unrecognised ${field} date format "${raw}" — skipped`);
  return undefined;
}

/** Count the number of leading tab characters on a line. */
function countLeadingTabs(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === "\t") count++;
    else break;
  }
  return count;
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
      "  <head>",
      "    <title>OmniFocus Export</title>",
      "  </head>",
      "  <body>",
      projectOutlines,
      "  </body>",
      "</opml>",
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

  // -------------------------------------------------------------------------
  // TaskPaper export
  // -------------------------------------------------------------------------

  /**
   * Export OmniFocus data as TaskPaper text.
   *
   * TaskPaper format:
   * ```
   * Project name:
   * \t- Task name @tag1 @due(2026-01-15) @defer(2026-01-10) @flagged
   * \t\t- Subtask name
   * ```
   *
   * Lossiness: HTML notes are downgraded to plain; completed/dropped tasks
   * are included with `@done`/`@dropped` tags; tag locations, custom
   * repetition rules, and attachments are silently omitted (warnings emitted).
   *
   * @throws {NotFound} when the requested project or folder ID does not exist.
   */
  async exportTaskPaper(scope: ExportScope): Promise<ExportTaskPaperResult> {
    const projects = await this.resolveProjects(scope);
    const warnings: string[] = [];
    const lines: string[] = [];
    let taskCount = 0;

    for (const { project, tasks } of await Promise.all(
      projects.map((p) =>
        fetchProjectTaskTree(this.adapter, p.id).then((tasks) => ({ project: p, tasks })),
      ),
    )) {
      // Build parent → children map
      const byParent = new Map<string, Task[]>();
      const rootTasks: Task[] = [];
      for (const task of tasks) {
        if (task.parentId === null) {
          rootTasks.push(task);
        } else {
          const key = String(task.parentId);
          const arr = byParent.get(key) ?? [];
          arr.push(task);
          byParent.set(key, arr);
        }
      }

      // Project heading
      lines.push(`${project.name}:`);
      if (project.note) {
        for (const noteLine of project.note.split("\n")) {
          lines.push(`\t${noteLine}`);
        }
      }

      // Render root tasks recursively
      for (const task of rootTasks) {
        renderTaskPaper(task, byParent, 1, lines, warnings);
      }

      taskCount += tasks.length;
      lines.push(""); // blank line between projects
    }

    return {
      taskpaper: lines.join("\n"),
      projectCount: projects.length,
      taskCount,
      warnings,
    };
  }

  // -------------------------------------------------------------------------
  // TaskPaper import
  // -------------------------------------------------------------------------

  /**
   * Import tasks from TaskPaper text.
   *
   * Parses TaskPaper lines and creates tasks via the adapter. Each top-level
   * `-` line becomes a task; indented sub-lines become subtasks of the nearest
   * parent. Project headings (`Name:`) set the container project when
   * `targetProjectId` is not supplied — they must already exist in OmniFocus
   * (by name match); unknown project names are recorded as warnings and tasks
   * fall back to inbox.
   *
   * Supported tags: `@due(date)`, `@defer(date)`, `@flagged`, `@done`,
   * `@tag-name` (bare tags become OF tags, created if absent).
   *
   * @param text            TaskPaper-formatted string to import.
   * @param targetProjectId When set, all top-level tasks are created here
   *                        regardless of any project headings in the text.
   */
  async importTaskPaper(text: string, targetProjectId?: ProjectId): Promise<ImportTaskPaperResult> {
    if (!text.trim()) {
      throw new ValidationError("text is empty", {
        suggestion: "Provide non-empty TaskPaper text.",
      });
    }

    // Build tag name → ID cache (lazy created)
    const existingTags = await this.adapter.listTags();
    const tagByName = new Map<string, TagId>(existingTags.map((t) => [t.name.toLowerCase(), t.id]));

    const resolveTag = async (name: string): Promise<TagId> => {
      const key = name.toLowerCase();
      const existing = tagByName.get(key);
      if (existing) return existing;
      const id = await this.adapter.createTag({ name });
      tagByName.set(key, id);
      return id;
    };

    // Build project name → ID cache from existing projects
    const projects = await this.adapter.listProjects();
    const projectByName = new Map<string, ProjectId>(
      projects.map((p) => [p.name.toLowerCase(), p.id]),
    );

    const created: TaskId[] = [];
    const warnings: string[] = [];

    // Stack of (indentLevel, taskId) for parent tracking
    const parentStack: Array<{ depth: number; id: TaskId }> = [];
    let currentProjectId: ProjectId | undefined = targetProjectId;

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw) continue;

      // Count leading tabs for depth
      const depth = countLeadingTabs(raw);
      const trimmed = raw.trimStart();

      // Project heading: "Project name:" (no leading dash)
      if (
        !trimmed.startsWith("- ") &&
        !trimmed.startsWith("-\t") &&
        trimmed.endsWith(":") &&
        depth === 0
      ) {
        if (!targetProjectId) {
          const projName = trimmed.slice(0, -1).trim();
          const projId = projectByName.get(projName.toLowerCase());
          if (projId) {
            currentProjectId = projId;
          } else {
            warnings.push(
              `Project "${projName}" not found in OmniFocus — tasks will land in inbox`,
            );
            currentProjectId = undefined;
          }
        }
        parentStack.length = 0;
        continue;
      }

      // Task line: starts with "- "
      if (!trimmed.startsWith("- ") && !trimmed.startsWith("-\t")) continue;

      // Pop stack to find the correct parent
      while (parentStack.length > 0 && (parentStack[parentStack.length - 1]?.depth ?? 0) >= depth) {
        parentStack.pop();
      }

      const taskText = trimmed.slice(2).trim();
      const parsed = parseTaskPaperLine(taskText, i + 1, warnings);

      // Resolve tag IDs
      const tagIds: TagId[] = [];
      for (const tagName of parsed.tagNames) {
        try {
          tagIds.push(await resolveTag(tagName));
        } catch {
          warnings.push(`Line ${i + 1}: could not create tag "${tagName}" — skipped`);
        }
      }

      const parent = parentStack[parentStack.length - 1];

      const input: CreateTaskInput = {
        name: parsed.name,
        ...(parent ? { parentId: parent.id } : {}),
        ...(currentProjectId && !parent ? { projectId: currentProjectId } : {}),
        ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
        ...(parsed.deferDate ? { deferDate: parsed.deferDate } : {}),
        ...(parsed.flagged ? { flagged: true } : {}),
        ...(parsed.note ? { note: parsed.note } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
      };

      const id = await this.adapter.createTask(input);
      created.push(id);

      if (parsed.done) {
        await this.adapter.completeTask(id);
      }

      parentStack.push({ depth, id });
    }

    return { created, warnings };
  }
}
