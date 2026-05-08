/**
 * JXA sandbox fixtures — lightweight fake OF entities for unit-testing JXA
 * script bodies without OmniFocus or osascript.
 *
 * Every `fake*` builder returns a plain object whose callable properties
 * (JXA returns values via zero-arg function calls) mirror the OmniFocus
 * JXA API surface. Optional overrides let callers supply throwing getters
 * to probe try/catch defensiveness inside scripts.
 *
 * Usage:
 *
 * ```ts
 * const tag = fakeTag({ name: "Work", creationDate: throwing("Can't get object.") });
 * const result = runJxaScriptInSandbox(tagListScript, {}, { tags: [tag] });
 * expect(result.tags[0].createdAt).toMatch(/^\d{4}-/); // fallback fired
 * ```
 *
 * @see src/adapter/jxa/sandbox/index.ts — sandbox runner
 * @see src/scripts/jxa/ — the JXA script bodies these fixtures model
 */

import { ScriptError } from "../../../errors/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a zero-arg function that always returns `value`. */
function fn<T>(value: T): () => T {
  return () => value;
}

/**
 * A function property that always throws, simulating OmniFocus JXA runtime
 * errors like "Can't get object." Use this to probe try/catch defensiveness
 * inside JXA script bodies.
 */
function throwing(msg = "Can't get object."): () => never {
  return () => {
    throw new ScriptError(msg, { details: { stderr: msg } });
  };
}

// ---------------------------------------------------------------------------
// Fake entity shapes
// ---------------------------------------------------------------------------

export interface FakeTagOverrides {
  id?: () => string;
  name?: () => string;
  parent?: () => unknown;
  status?: () => string;
  location?: () => unknown;
  creationDate?: () => Date;
  modificationDate?: () => Date;
  allowsNextAction?: () => boolean;
  tasks?: () => unknown[];
}

export interface FakeTag {
  id: () => string;
  name: () => string;
  parent: () => unknown;
  status: () => string;
  location: () => unknown;
  creationDate: () => Date;
  modificationDate: () => Date;
  allowsNextAction: () => boolean;
  tasks: () => unknown[];
}

let _tagSeq = 0;

/**
 * Build a fake JXA Tag object.
 *
 * @param overrides - Per-property replacements. Pass a throwing getter to
 *   assert that the script's try/catch path handles that property gracefully.
 */
export function fakeTag(
  overrides: FakeTagOverrides & { id?: () => string; name?: () => string } = {},
): FakeTag {
  const id = overrides.id ?? fn(`tag_${++_tagSeq}`);
  const name = overrides.name ?? fn(`Tag ${_tagSeq}`);
  const now = new Date();
  return {
    id,
    name,
    parent: overrides.parent ?? throwing(),
    status: overrides.status ?? fn("active"),
    location: overrides.location ?? fn(null),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    allowsNextAction: overrides.allowsNextAction ?? fn(false),
    tasks: overrides.tasks ?? fn([]),
  };
}

export interface FakeTaskOverrides {
  id?: () => string;
  name?: () => string;
  containingProject?: () => unknown;
  parentTask?: () => unknown;
  tags?: () => unknown[];
  deferDate?: () => Date | null;
  dueDate?: () => Date | null;
  completionDate?: () => Date | null;
  dropped?: () => boolean;
  completed?: () => boolean;
  flagged?: () => boolean;
  effectivelyDropped?: () => boolean;
  blocked?: () => boolean;
  numberOfTasks?: () => number;
  estimatedMinutes?: () => number | null;
  repetitionRule?: () => unknown;
  note?: () => string;
  creationDate?: () => Date;
  modificationDate?: () => Date;
  inInbox?: () => boolean;
  sequential?: () => boolean;
  completedByChildren?: () => boolean;
  availabilityStatus?: () => string;
  deferDateFloating?: () => boolean;
  dueDateFloating?: () => boolean;
  // build_task.js with `effectiveAvailability: true` calls this; the
  // forecast and search scripts both pass that option.
  effectivelyAvailable?: () => boolean;
  // attachment_list reads this on tasks; default empty array, override
  // with [fakeAttachment(...)] in tests that exercise attachments.
  fileAttachments?: () => unknown[];
}

let _taskSeq = 0;

/** Build a fake JXA Task object. */
export function fakeTask(
  overrides: FakeTaskOverrides & { id?: () => string; name?: () => string } = {},
) {
  const id = overrides.id ?? fn(`task_${++_taskSeq}`);
  const name = overrides.name ?? fn(`Task ${_taskSeq}`);
  const now = new Date();
  return {
    id,
    name,
    containingProject: overrides.containingProject ?? throwing(),
    parentTask: overrides.parentTask ?? throwing(),
    tags: overrides.tags ?? fn([]),
    deferDate: overrides.deferDate ?? fn(null),
    dueDate: overrides.dueDate ?? fn(null),
    completionDate: overrides.completionDate ?? fn(null),
    dropped: overrides.dropped ?? fn(false),
    completed: overrides.completed ?? fn(false),
    flagged: overrides.flagged ?? fn(false),
    effectivelyDropped: overrides.effectivelyDropped ?? fn(false),
    blocked: overrides.blocked ?? fn(false),
    numberOfTasks: overrides.numberOfTasks ?? fn(0),
    estimatedMinutes: overrides.estimatedMinutes ?? fn(null),
    repetitionRule: overrides.repetitionRule ?? fn(null),
    note: overrides.note ?? fn(""),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    inInbox: overrides.inInbox ?? fn(false),
    sequential: overrides.sequential ?? fn(false),
    completedByChildren: overrides.completedByChildren ?? fn(false),
    availabilityStatus: overrides.availabilityStatus ?? fn("available"),
    deferDateFloating: overrides.deferDateFloating ?? fn(false),
    dueDateFloating: overrides.dueDateFloating ?? fn(false),
    effectivelyAvailable: overrides.effectivelyAvailable ?? fn(true),
    fileAttachments: overrides.fileAttachments ?? fn([]),
  };
}

export interface FakeProjectOverrides {
  id?: () => string;
  name?: () => string;
  containingFolder?: () => unknown;
  tasks?: () => unknown[];
  flattenedTasks?: () => unknown[];
  status?: () => string;
  completionDate?: () => Date | null;
  deferDate?: () => Date | null;
  dueDate?: () => Date | null;
  flagged?: () => boolean;
  estimatedMinutes?: () => number | null;
  numberOfTasks?: () => number;
  numberOfAvailableTasks?: () => number;
  completionCriterion?: () => string;
  sequential?: () => boolean;
  note?: () => string;
  creationDate?: () => Date;
  modificationDate?: () => Date;
  reviewInterval?: () => unknown;
  // OF 4.x exposes the review interval expressed in days as a separate
  // computed property — review_list_due.js reads it directly via
  // `p.reviewIntervalDays()`.
  reviewIntervalDays?: () => number | null;
  nextReviewDate?: () => Date | null;
  effectiveStatus?: () => string;
  lastReviewDate?: () => Date | null;
  deferDateFloating?: () => boolean;
  dueDateFloating?: () => boolean;
  // attachment_list reads this on projects; default empty array.
  fileAttachments?: () => unknown[];
}

let _projectSeq = 0;

/** Build a fake JXA Project object. */
export function fakeProject(
  overrides: FakeProjectOverrides & { id?: () => string; name?: () => string } = {},
) {
  const id = overrides.id ?? fn(`project_${++_projectSeq}`);
  const name = overrides.name ?? fn(`Project ${_projectSeq}`);
  const now = new Date();
  return {
    id,
    name,
    containingFolder: overrides.containingFolder ?? throwing(),
    tasks: overrides.tasks ?? fn([]),
    flattenedTasks: overrides.flattenedTasks ?? fn([]),
    status: overrides.status ?? fn("active"),
    completionDate: overrides.completionDate ?? fn(null),
    deferDate: overrides.deferDate ?? fn(null),
    dueDate: overrides.dueDate ?? fn(null),
    flagged: overrides.flagged ?? fn(false),
    estimatedMinutes: overrides.estimatedMinutes ?? fn(null),
    numberOfTasks: overrides.numberOfTasks ?? fn(0),
    numberOfAvailableTasks: overrides.numberOfAvailableTasks ?? fn(0),
    completionCriterion: overrides.completionCriterion ?? fn("parallel"),
    sequential: overrides.sequential ?? fn(false),
    note: overrides.note ?? fn(""),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    reviewInterval: overrides.reviewInterval ?? fn(null),
    reviewIntervalDays: overrides.reviewIntervalDays ?? fn(null),
    nextReviewDate: overrides.nextReviewDate ?? fn(null),
    effectiveStatus: overrides.effectiveStatus ?? fn("active"),
    lastReviewDate: overrides.lastReviewDate ?? fn(null),
    deferDateFloating: overrides.deferDateFloating ?? fn(false),
    dueDateFloating: overrides.dueDateFloating ?? fn(false),
    fileAttachments: overrides.fileAttachments ?? fn([]),
  };
}

export interface FakeFolderOverrides {
  id?: () => string;
  name?: () => string;
  container?: () => unknown;
  // build_folder.js falls back to `folder.parent()` when no parentMap is
  // supplied. Tests that exercise that fallback — or that want to prove it
  // is not called when a parentMap exists — override this.
  parent?: () => unknown;
  folders?: () => unknown[];
  projects?: () => unknown[];
  note?: () => string;
  status?: () => string;
  creationDate?: () => Date;
  modificationDate?: () => Date;
}

let _folderSeq = 0;

/** Build a fake JXA Folder object. */
export function fakeFolder(
  overrides: FakeFolderOverrides & { id?: () => string; name?: () => string } = {},
) {
  const id = overrides.id ?? fn(`folder_${++_folderSeq}`);
  const name = overrides.name ?? fn(`Folder ${_folderSeq}`);
  const now = new Date();
  return {
    id,
    name,
    container: overrides.container ?? throwing(),
    parent: overrides.parent ?? throwing(),
    folders: overrides.folders ?? fn([]),
    projects: overrides.projects ?? fn([]),
    note: overrides.note ?? fn(""),
    status: overrides.status ?? fn("active"),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
  };
}

// ---------------------------------------------------------------------------
// Attachment / window / perspective fakes (slice 2b)
// ---------------------------------------------------------------------------

export interface FakeAttachmentOverrides {
  id?: () => string;
  name?: () => string;
  fileType?: () => string | null;
  fileSize?: () => number | null;
  creationDate?: () => Date;
  /**
   * `attachment_list.js` calls `att.linked?.()` — pass `undefined` (the
   * default) to omit the method entirely (script reads `kind: "embedded"`),
   * or supply `() => true` for the alias path.
   */
  linked?: (() => boolean) | undefined;
}

let _attachmentSeq = 0;

/** Build a fake JXA Attachment object as used by `attachment_list.js`. */
export function fakeAttachment(overrides: FakeAttachmentOverrides = {}) {
  const id = overrides.id ?? fn(`att_${++_attachmentSeq}`);
  const name = overrides.name ?? fn(`Attachment ${_attachmentSeq}`);
  const now = new Date();
  const base: Record<string, unknown> = {
    id,
    name,
    fileType: overrides.fileType ?? fn(null),
    fileSize: overrides.fileSize ?? fn(null),
    creationDate: overrides.creationDate ?? fn(now),
  };
  if (overrides.linked !== undefined) base.linked = overrides.linked;
  return base;
}

export interface FakeWindowOverrides {
  perspectiveName?: () => string;
  /** Array of focus containers; each must expose `.id()`. */
  focus?: () => Array<{ id: () => string }>;
}

/** Build a fake JXA Window object as used by `window_get_state.js`. */
export function fakeWindow(overrides: FakeWindowOverrides = {}) {
  return {
    perspectiveName: overrides.perspectiveName ?? fn("Forecast"),
    focus: overrides.focus ?? fn([]),
  };
}

export interface FakePerspectiveOverrides {
  id?: () => string;
  name?: () => string;
}

let _perspectiveSeq = 0;

/** Build a fake JXA Perspective object as used by `perspective_list.js`. */
export function fakePerspective(overrides: FakePerspectiveOverrides = {}) {
  const id = overrides.id ?? fn(`perspective_${++_perspectiveSeq}`);
  const name = overrides.name ?? fn(`Perspective ${_perspectiveSeq}`);
  return { id, name };
}

/** Expose the throwing() helper so test authors can inject faults. */
export { throwing };
