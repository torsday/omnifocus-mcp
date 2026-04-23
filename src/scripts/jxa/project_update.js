/**
 * JXA: update mutable fields on an existing project.
 *
 * Args (argv[0] JSON): { id: string, name?: string, note?: string|null,
 *   noteHtml?: string|null, status?: string, folderId?: string|null,
 *   deferDate?: string|null, dueDate?: string|null, flagged?: boolean,
 *   estimatedMinutes?: number|null }
 * Returns JSON: { project: Project }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/project.ts — Project domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  function normalizeStatus(raw) {
    if (raw === "on hold") return "on-hold";
    if (raw === "done") return "completed";
    return raw;
  }

  function buildProject(proj) {
    let folderId = null;
    try {
      const f = proj.folder();
      if (f && f.class() !== "document") folderId = f.id();
    } catch (_e) {}

    const tagIds = [];
    try {
      const tags = proj.tags();
      for (let i = 0; i < tags.length; i++) {
        tagIds.push(tags[i].id());
      }
    } catch (_e) {}

    let rawStatus = "active";
    try {
      rawStatus = proj.status();
    } catch (_e) {}
    const status = normalizeStatus(rawStatus);

    let deferDate = null;
    try {
      const dd = proj.deferDate();
      if (dd) deferDate = dd.toISOString();
    } catch (_e) {}

    let dueDate = null;
    try {
      const due = proj.dueDate();
      if (due) dueDate = due.toISOString();
    } catch (_e) {}

    let completedAt = null;
    try {
      const cd = proj.completionDate();
      if (cd) completedAt = cd.toISOString();
    } catch (_e) {}

    let estimatedMinutes = null;
    try {
      const em = proj.estimatedMinutes();
      if (em != null) estimatedMinutes = em;
    } catch (_e) {}

    let note = null;
    try {
      note = proj.note() || null;
    } catch (_e) {}

    let noteHtml = null;
    try {
      if (proj.noteHtml) noteHtml = proj.noteHtml() || null;
    } catch (_e) {}

    let flagged = false;
    try {
      flagged = proj.flagged();
    } catch (_e) {}

    let reviewIntervalDays = null;
    try {
      const ri = proj.reviewInterval();
      if (ri?.steps) reviewIntervalDays = ri.steps();
    } catch (_e) {}

    let nextReviewDate = null;
    try {
      const nrd = proj.nextReviewDate();
      if (nrd) nextReviewDate = nrd.toISOString();
    } catch (_e) {}

    let lastReviewDate = null;
    try {
      const lrd = proj.lastReviewDate ? proj.lastReviewDate() : null;
      if (lrd) lastReviewDate = lrd.toISOString();
    } catch (_e) {}

    let taskCount = 0;
    try {
      taskCount = proj.numberOfTasks();
    } catch (_e) {}

    let completedTaskCount = 0;
    try {
      completedTaskCount = proj.numberOfCompletedTasks();
    } catch (_e) {}

    let completionCriterion = "parallel";
    try {
      const cc = proj.completionCriterion ? proj.completionCriterion() : "parallel";
      completionCriterion = cc;
    } catch (_e) {}

    return {
      id: proj.id(),
      name: proj.name(),
      note: note,
      noteHtml: noteHtml,
      folderId: folderId,
      tagIds: tagIds,
      status: status,
      completionCriterion: completionCriterion,
      deferDate: deferDate,
      dueDate: dueDate,
      estimatedMinutes: estimatedMinutes,
      flagged: flagged,
      reviewIntervalDays: reviewIntervalDays,
      nextReviewDate: nextReviewDate,
      lastReviewDate: lastReviewDate,
      completed: status === "completed",
      completedAt: completedAt,
      dropped: status === "dropped",
      droppedAt: status === "dropped" ? completedAt : null,
      taskCount: taskCount,
      completedTaskCount: completedTaskCount,
      createdAt: proj.creationDate ? proj.creationDate().toISOString() : new Date().toISOString(),
      modifiedAt: proj.modificationDate
        ? proj.modificationDate().toISOString()
        : new Date().toISOString(),
    };
  }

  const allProjects = ofApp.defaultDocument.flattenedProjects();
  let target = null;
  for (let i = 0; i < allProjects.length; i++) {
    if (allProjects[i].id() === args.id) {
      target = allProjects[i];
      break;
    }
  }
  if (!target) throw new Error(`Project not found: ${args.id}`);

  if (args.name !== undefined) target.name = args.name;
  if (args.note !== undefined) target.note = args.note ?? "";
  if (args.flagged !== undefined) target.flagged = args.flagged;
  if (args.estimatedMinutes !== undefined) target.estimatedMinutes = args.estimatedMinutes ?? 0;
  if (args.deferDate !== undefined)
    target.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  if (args.dueDate !== undefined) target.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  if (args.status !== undefined) {
    const jxaStatus = args.status === "on-hold" ? "on hold" : args.status;
    target.status = jxaStatus;
  }
  if (args.folderId !== undefined) {
    if (args.folderId) {
      const folder = ofApp.defaultDocument.folders.byId(args.folderId);
      target.move({ to: folder.projects.end });
    } else {
      target.move({ to: ofApp.defaultDocument.projects.end });
    }
  }

  return JSON.stringify({ project: buildProject(target) });
}
