/**
 * JXA: list projects, optionally filtered by folderId or status.
 *
 * Args (argv[0] JSON): { folderId?: string|null, status?: string|null }
 * Returns JSON: { projects: Project[] }
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
    return raw; // "active", "dropped"
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

  let projects;
  if (args.folderId) {
    try {
      const folder = ofApp.defaultDocument.folders.byId(args.folderId);
      projects = folder.projects();
    } catch (_e) {
      throw new Error(`Folder not found: ${args.folderId}`);
    }
  } else {
    projects = ofApp.defaultDocument.flattenedProjects();
  }

  const result = [];
  for (let i = 0; i < projects.length; i++) {
    const built = buildProject(projects[i]);
    if (args.status !== null && args.status !== undefined && built.status !== args.status) continue;
    result.push(built);
  }

  return JSON.stringify({ projects: result });
}
