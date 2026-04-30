/**
 * JXA: create a new project.
 *
 * Args (argv[0] JSON): { name: string, folderId?: string|null, note?: string|null,
 *   deferDate?: string|null, dueDate?: string|null, estimatedMinutes?: number|null,
 *   flagged?: boolean, status?: string|null, tagIds?: string[] }
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
    // OmniFocus 4.8.8 returns verbose strings with a " status" suffix
    // (e.g. "active status", "on hold status"). Strip for uniform handling.
    const s = typeof raw === "string" ? raw.replace(/ status$/, "") : raw;
    if (s === "on hold") return "on-hold";
    if (s === "done") return "completed";
    return s; // "active", "dropped"
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
        try {
          tagIds.push(tags[i].id());
        } catch (_tagErr) {}
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
      // Guard against "Can't get object." thrown when invoking these — see #498.

      createdAt: (() => {
        try {
          return proj.creationDate().toISOString();
        } catch (_e) {
          return new Date().toISOString();
        }
      })(),

      modifiedAt: (() => {
        try {
          return proj.modificationDate().toISOString();
        } catch (_e) {
          return new Date().toISOString();
        }
      })(),
    };
  }

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }

  const props = { name: args.name };
  if (args.note != null) props.note = args.note;
  if (args.deferDate != null) props.deferDate = new Date(args.deferDate);
  if (args.dueDate != null) props.dueDate = new Date(args.dueDate);
  if (args.estimatedMinutes != null) props.estimatedMinutes = args.estimatedMinutes;
  if (args.flagged != null) props.flagged = args.flagged;
  if (args.status != null) {
    // OmniFocus 4.8.8+ requires the " status" suffix on assignment values
    // (without it the assignment silently no-ops on `on hold`). Same as the
    // fix in project_update.js. Note: createProject now routes through
    // OmniJS per ADR-0019, so this JXA path is effectively dead code; the
    // fix is here for defense in depth in case the routing flips back.
    props.status = args.status === "on-hold" ? "on hold status" : "active status";
  }

  // OmniFocus 4.x rejects `doc.make({ new: "project", withProperties })` with
  // error -10024. The working pattern mirrors the inbox-task fix in #275:
  // construct a specifier via the class name and push it onto the collection.
  let newProj;
  if (args.folderId) {
    const folder = ofApp.defaultDocument.folders.byId(args.folderId);
    if (!folder) throw new Error(`Folder not found: ${args.folderId}`);
    newProj = ofApp.Project(props);
    folder.projects.push(newProj);
  } else {
    newProj = ofApp.Project(props);
    ofApp.defaultDocument.projects.push(newProj);
  }

  return JSON.stringify({ project: buildProject(newProj) });
}
