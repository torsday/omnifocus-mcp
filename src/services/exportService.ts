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
import { NotFound, ValidationError } from "../errors/index.js";
import { renderProjectOutline } from "./export/opml.js";
import { type OutlineNode, parseOpml } from "./export/opmlParser.js";
import { countLeadingTabs, parseTaskPaperLine, renderTaskPaper } from "./export/taskpaper.js";
import { fetchProjectTaskTree, partitionTasksByParent } from "./export/tree.js";

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

export interface ImportOpmlResult {
  /**
   * Number of tasks (leaf outlines) imported.
   *
   * **Lossiness:** OPML preserves text and nesting only. Due dates, defer
   * dates, and flagged state encoded in `omnifocus:task` attributes are
   * retained on round-trip. Tags, attachments, notes, repetition rules,
   * and other OmniFocus-specific metadata are not encoded in OPML and will
   * be silently dropped.
   */
  imported: number;
  /** IDs of every task created. */
  taskIds: TaskId[];
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
      const { rootTasks, byParent } = partitionTasksByParent(tasks);

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
   * Supported tags: `@due(date)`, `@defer(date)`, `@flagged`, `@done` /
   * `@done(date)` (the native TaskPaper form; the timestamp is honoured),
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
        // Honour the native `@done(date)` timestamp when present; bare
        // `@done` falls back to the adapter's "now".
        if (parsed.doneDate) {
          await this.adapter.completeTask(id, new Date(parsed.doneDate));
        } else {
          await this.adapter.completeTask(id);
        }
      }

      parentStack.push({ depth, id });
    }

    return { created, warnings };
  }

  // ---------------------------------------------------------------------------
  // importOpml
  // ---------------------------------------------------------------------------

  /**
   * Parse an OPML XML string and create tasks in OmniFocus.
   *
   * Follows the structure produced by `export_opml`:
   * - Top-level `<outline type="omnifocus:project">` elements are matched
   *   to existing projects by their `id` attribute first, then by `text`
   *   (name) as a fallback. Unrecognised projects land in the inbox.
   * - Nested `<outline>` elements become tasks under their parent, preserving
   *   hierarchy depth.
   * - `destinationProjectId` overrides all project matching — every top-level
   *   outline is imported into that project regardless of type or id.
   *
   * **Lossiness:** OPML preserves text and nesting only. Due/defer dates and
   * flagged state encoded as attributes are retained; tags, notes,
   * attachments, repetition rules, and other metadata are dropped.
   *
   * @throws {ValidationError} when `opml` is empty or not well-formed OPML.
   */
  async importOpml(
    opml: string,
    opts: { destinationProjectId?: ProjectId } = {},
  ): Promise<ImportOpmlResult> {
    if (!opml.trim()) {
      throw new ValidationError("opml is empty", {
        suggestion: "Provide a non-empty OPML XML string.",
      });
    }

    // parseOpml throws ValidationError directly on malformed input.
    const parsed = parseOpml(opml);

    // Build project lookup caches for project-type outlines:
    // - By OmniFocus ID string (round-trip from export_opml)
    // - By name (case-insensitive fallback)
    const projects = await this.adapter.listProjects();
    const projectById = new Map<string, ProjectId>(projects.map((p) => [String(p.id), p.id]));
    const projectByName = new Map<string, ProjectId>(
      projects.map((p) => [p.name.toLowerCase(), p.id]),
    );

    const allTaskIds: TaskId[] = [];

    /**
     * Recursively create outline nodes as tasks.
     *
     * @param nodes    - Outline nodes to import
     * @param projectId - Project to create tasks in (undefined → inbox)
     * @param parentId  - Parent task ID for nested tasks (undefined → top-level)
     */
    const importNodes = async (
      nodes: OutlineNode[],
      projectId: ProjectId | undefined,
      parentId: TaskId | undefined,
    ): Promise<void> => {
      for (const node of nodes) {
        // The adapter rejects tasks with both projectId and parentId set.
        // parentId takes precedence for child tasks — the project is implied.
        const input: CreateTaskInput = {
          name: node.text || "(untitled)",
          ...(parentId !== undefined ? { parentId } : projectId !== undefined ? { projectId } : {}),
          ...(node.due !== undefined ? { dueDate: node.due } : {}),
          ...(node.defer !== undefined ? { deferDate: node.defer } : {}),
          ...(node.flagged === true ? { flagged: true } : {}),
        };

        const taskId = await this.adapter.createTask(input);
        allTaskIds.push(taskId);

        if (node.children.length > 0) {
          await importNodes(node.children, projectId, taskId);
        }
      }
    };

    for (const topNode of parsed.body) {
      if (opts.destinationProjectId !== undefined) {
        // User supplied an explicit destination — import everything there.
        await importNodes([topNode], opts.destinationProjectId, undefined);
        continue;
      }

      // Top-level outline: if it's a project-type, resolve to the matching project.
      if (topNode.type === "omnifocus:project") {
        // Try matching by OF ID first (round-trip from export_opml), then by name.
        const resolvedId =
          (topNode.id !== undefined ? projectById.get(topNode.id) : undefined) ??
          projectByName.get(topNode.text.toLowerCase());

        // Import tasks inside this project outline into the matched project (or inbox).
        await importNodes(topNode.children, resolvedId, undefined);
      } else {
        // Plain task outline (or non-project type) — land in inbox.
        await importNodes([topNode], undefined, undefined);
      }
    }

    return { imported: allTaskIds.length, taskIds: allTaskIds };
  }
}
