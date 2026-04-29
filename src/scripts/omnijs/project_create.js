/**
 * OmniJS: create a new project.
 *
 * Routes through OmniJS rather than JXA per ADR-0019: JXA's
 * `Project(props) + push()` returns a transient specifier ID that doesn't
 * match OmniFocus's persistent `id.primaryKey`, so subsequent OmniJS-routed
 * operations (moveTask, reorderTask, etc.) fail to resolve the project.
 * OmniJS's `new Project(name, position)` returns a project whose
 * `id.primaryKey` is interoperable with both transports.
 *
 * Args injected as `globalThis.__args`:
 *   {
 *     name: string,
 *     folderId?: string|null,
 *     note?: string|null,
 *     deferDate?: string|null,    // ISO-8601-with-offset
 *     dueDate?: string|null,      // ISO-8601-with-offset
 *     estimatedMinutes?: number|null,
 *     flagged?: boolean,
 *     status?: "active" | "on-hold" | "done" | "dropped" | null,
 *     completionCriterion?: "parallel" | "sequential" | "singleActions" | null,
 *     reviewIntervalDays?: number|null,
 *     nextReviewDate?: string|null,  // ISO-8601-with-offset
 *   }
 *
 * Returns JSON: { project: Project } where Project mirrors the JXA build shape.
 *
 * @see src/adapter/omnijs/OmniJsTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 * @see docs/adr/0019-cross-transport-id-interoperability.md — routing rationale
 */
(() => {
  const args = globalThis.__args;

  if (!args.name || args.name.trim() === "") {
    return JSON.stringify({
      error: { code: "VALIDATION", message: "name is required and cannot be empty" },
    });
  }

  // Resolve placement: a Folder, or the library root.
  // The folder is itself a `Section` with `.beginning` / `.ending` as
  // ChildInsertionLocation values — `folder.children.ending` does NOT place
  // the project inside the folder (verified empirically: the project lands
  // at the library root with `folder.children.ending`, in the folder with
  // `folder.ending`).
  let position;
  if (args.folderId != null) {
    const folder = flattenedFolders.filter((f) => f.id.primaryKey === args.folderId)[0];
    if (!folder) {
      return JSON.stringify({
        error: { code: "NOT_FOUND", message: `Folder not found: ${args.folderId}` },
      });
    }
    position = folder.ending;
  } else {
    position = library.ending;
  }

  // `new Project(name, position)` is the canonical OmniJS create — produces
  // a real persistent id.primaryKey.
  const proj = new Project(args.name, position);

  // Set props post-construction. OmniJS exposes them as plain assignments.
  if (args.note != null) proj.note = args.note;
  if (args.deferDate != null) proj.deferDate = new Date(args.deferDate);
  if (args.dueDate != null) proj.dueDate = new Date(args.dueDate);
  if (args.estimatedMinutes != null) proj.estimatedMinutes = args.estimatedMinutes;
  if (args.flagged != null) proj.flagged = args.flagged;
  if (args.status != null) {
    // Map the wire-stable status enum to the OmniJS Project.Status constants.
    // Wire: "active" | "on-hold" | "done" | "dropped"
    const statusMap = {
      active: Project.Status.Active,
      "on-hold": Project.Status.OnHold,
      done: Project.Status.Done,
      dropped: Project.Status.Dropped,
    };
    const target = statusMap[args.status];
    if (target !== undefined) proj.status = target;
  }
  if (args.completionCriterion != null) {
    if (args.completionCriterion === "sequential") proj.sequential = true;
    else if (args.completionCriterion === "singleActions") {
      // singleActions: containsSingletonActions=true means project completes
      // when all its singleton actions complete (or via the singleton flag).
      proj.containsSingletonActions = true;
    }
    // "parallel" is the default — sequential=false, containsSingletonActions=false.
  }
  if (args.reviewIntervalDays != null) {
    // OmniJS Project.reviewInterval takes a `Project.ReviewInterval` value
    // constructed via `{ steps, unit }`. Days is the canonical unit here.
    proj.reviewInterval = { steps: args.reviewIntervalDays, unit: "day" };
  }
  if (args.nextReviewDate != null) {
    proj.nextReviewDate = new Date(args.nextReviewDate);
  }

  // Build the response Project — mirrors src/scripts/jxa/project_create.js's
  // buildProject shape so the wire format is identical regardless of transport.
  function statusToWire(s) {
    if (s === Project.Status.Active) return "active";
    if (s === Project.Status.OnHold) return "on-hold";
    if (s === Project.Status.Done) return "done";
    if (s === Project.Status.Dropped) return "dropped";
    return "active";
  }

  function completionCriterionToWire(p) {
    if (p.containsSingletonActions) return "singleActions";
    if (p.sequential) return "sequential";
    return "parallel";
  }

  function isoOrNull(d) {
    return d ? d.toISOString() : null;
  }

  const status = statusToWire(proj.status);
  const folderIdOut =
    proj.parentFolder !== null && proj.parentFolder !== undefined
      ? proj.parentFolder.id.primaryKey
      : null;
  // Project-level tags live on `proj.task.tags` (OmniJS models the project as
  // a wrapping task; tags are owned by that inner task object).
  const tagIdsOut = proj.task ? proj.task.tags.map((t) => t.id.primaryKey) : [];

  return JSON.stringify({
    project: {
      id: proj.id.primaryKey,
      name: proj.name,
      note: proj.note || null,
      noteHtml: null, // OmniJS doesn't expose noteHtml on Project; same as JXA's degraded path.
      folderId: folderIdOut,
      tagIds: tagIdsOut,
      status: status,
      completionCriterion: completionCriterionToWire(proj),
      deferDate: isoOrNull(proj.deferDate),
      dueDate: isoOrNull(proj.dueDate),
      estimatedMinutes: proj.estimatedMinutes ?? null,
      flagged: proj.flagged ?? false,
      reviewIntervalDays:
        proj.reviewInterval && proj.reviewInterval.steps != null ? proj.reviewInterval.steps : null,
      nextReviewDate: isoOrNull(proj.nextReviewDate),
      lastReviewDate: isoOrNull(proj.lastReviewDate),
      completed: status === "done",
      completedAt: isoOrNull(proj.task ? proj.task.completionDate : null),
      dropped: status === "dropped",
      droppedAt: isoOrNull(proj.task ? proj.task.dropDate : null),
      taskCount: proj.flattenedTasks ? proj.flattenedTasks.length : 0,
      completedTaskCount: proj.flattenedTasks
        ? proj.flattenedTasks.filter((t) => t.completed).length
        : 0,
      createdAt: isoOrNull(proj.added) || new Date().toISOString(),
      modifiedAt: isoOrNull(proj.modified) || new Date().toISOString(),
    },
  });
})();
