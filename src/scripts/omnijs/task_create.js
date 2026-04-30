/**
 * OmniJS: create a new task.
 *
 * Routes through OmniJS rather than JXA per ADR-0019: JXA's
 * `Task(props) + push()` returns a transient specifier ID that doesn't
 * match OmniFocus's persistent `id.primaryKey`, so subsequent OmniJS-routed
 * operations (moveTask, reorderTask, duplicateTask) fail to resolve the
 * task. OmniJS's `new Task(name, position)` returns a task whose
 * `id.primaryKey` is interoperable with both transports.
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     name: string,
 *     projectId?: string|null,
 *     parentId?: string|null,
 *     note?: string|null,
 *     flagged?: boolean,
 *     deferDate?: string|null,
 *     dueDate?: string|null,
 *     estimatedMinutes?: number|null,
 *     tagIds?: string[],
 *     sequential?: boolean,
 *     completedByChildren?: boolean,
 *   }
 *   `projectId` and `parentId` are mutually exclusive; pass neither for an
 *   inbox task.
 *
 * Returns JSON: { task: Task } where Task mirrors the JXA build shape.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — caller
 * @see src/domain/task.ts — Task domain type
 * @see docs/adr/0019-cross-transport-id-interoperability.md — routing rationale
 * @see src/scripts/omnijs/project_create.js — sibling pattern (#681)
 */
(() => {
  const args = globalThis.__args;

  if (!args.name || args.name.trim() === "") {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "name is required and cannot be empty" },
    });
  }
  if (args.projectId != null && args.parentId != null) {
    return JSON.stringify({
      error: {
        code: "VALIDATION",
        message: "projectId and parentId are mutually exclusive",
      },
    });
  }

  // Resolve placement. OmniJS Task constructor takes a `Task.ChildInsertionLocation`:
  //   - `parentTask.ending` for "as a child of this task"
  //   - `project.ending`    for "as a top-level action of this project"
  //   - `inbox.ending`      for "in the inbox"
  let position;
  if (args.parentId != null) {
    const parent = flattenedTasks.filter((t) => t.id.primaryKey === args.parentId)[0];
    if (!parent) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Parent task not found: ${args.parentId}` },
      });
    }
    position = parent.ending;
  } else if (args.projectId != null) {
    const proj = flattenedProjects.filter((p) => p.id.primaryKey === args.projectId)[0];
    if (!proj) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Project not found: ${args.projectId}` },
      });
    }
    position = proj.ending;
  } else {
    position = inbox.ending;
  }

  const task = new Task(args.name, position);

  // Set props post-construction.
  if (args.note != null) task.note = args.note;
  if (args.flagged != null) task.flagged = args.flagged;
  if (args.deferDate != null) task.deferDate = new Date(args.deferDate);
  if (args.dueDate != null) task.dueDate = new Date(args.dueDate);
  if (args.estimatedMinutes != null) task.estimatedMinutes = args.estimatedMinutes;
  if (args.sequential != null) task.sequential = args.sequential;
  if (args.completedByChildren != null) {
    task.containsSingletonActions = args.completedByChildren;
  }

  // Apply tags. OmniJS exposes `Task.addTag(tag)`.
  if (args.tagIds && args.tagIds.length > 0) {
    for (const tagId of args.tagIds) {
      const tag = flattenedTags.filter((t) => t.id.primaryKey === tagId)[0];
      if (tag) task.addTag(tag);
      // Missing tags are silently skipped (matches JXA behavior in
      // task_create.js's tagIds loop) — caller-supplied tag lists may
      // include stale ids that we don't want to fail the whole create on.
    }
  }

  // Build the response Task — mirror the JXA buildTask shape so the wire
  // format is identical regardless of transport routing.
  function isoOrNull(d) {
    return d ? d.toISOString() : null;
  }

  // OmniJS exposes containingProject / parent / tags / dates on Task as
  // direct properties — no .class() coercion or lazy-specifier traps.
  const cp = task.containingProject;
  const projectIdOut = cp?.id ? cp.id.primaryKey : null;
  const parentTask = task.parent;
  // Task.parent on a top-level task in a project returns the project's task
  // (Project-as-Task). We only want a parentId when the user actually
  // assigned a parent task.
  const parentIdOut = parentTask?.id && args.parentId != null ? parentTask.id.primaryKey : null;
  const tagIdsOut = task.tags ? task.tags.map((t) => t.id.primaryKey) : [];

  // Repetition rule. OmniJS exposes `Task.repetitionRule` (a `Task.RepetitionRule`
  // value with `method`, `ruleString`, etc.). We don't set repetition on create
  // (that's a separate tool path), so this is null on freshly-created tasks.
  const repetition = null;

  return JSON.stringify({
    task: {
      id: task.id.primaryKey,
      name: task.name,
      note: task.note || null,
      noteHtml: null, // OmniJS doesn't expose noteHtml; matches JXA's degraded path.
      projectId: projectIdOut,
      parentId: parentIdOut,
      tagIds: tagIdsOut,
      deferDate: isoOrNull(task.deferDate),
      dueDate: isoOrNull(task.dueDate),
      estimatedMinutes: task.estimatedMinutes ?? null,
      flagged: task.flagged ?? false,
      completed: task.completed ?? false,
      completedAt: isoOrNull(task.completionDate),
      dropped: task.dropped ?? false,
      droppedAt: isoOrNull(task.dropDate),
      // `available` and `blocked` reflect computed task state. OmniJS exposes
      // `taskStatus` rather than separate `available`/`blocked`; map it.
      available: task.taskStatus === Task.Status.Available,
      blocked: task.taskStatus === Task.Status.Blocked,
      sequential: task.sequential ?? false,
      completedByChildren: task.containsSingletonActions ?? false,
      repetition: repetition,
      createdAt: isoOrNull(task.added) || new Date().toISOString(),
      modifiedAt: isoOrNull(task.modified) || new Date().toISOString(),
    },
  });
})();
