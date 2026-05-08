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
import { defineWritableAccessor, defineWritableNameAccessor } from "./index.js";

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
  // Child tags (nested tag tree). tag_create.js calls
  // `parentTag.tags.push(newTag)`; expose this as a callable that doubles
  // as a push-target so the mutation propagates to subsequent reads.
  tags?: () => unknown[];
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
) {
  const id = overrides.id ?? fn(`tag_${++_tagSeq}`);
  const now = new Date();
  // Child-tag collection: pushable callable. Captures the override array
  // (if any) at construction; subsequent push() mutates it in place so
  // post-mutation reads via `tag.tags()` see the additions.
  const childrenArr: unknown[] = overrides.tags ? Array.from(overrides.tags()) : [];
  const tags = Object.assign(() => childrenArr, {
    push: (item: unknown) => childrenArr.push(item),
  });
  const tag: Record<string, unknown> = {
    id,
    parent: overrides.parent ?? throwing(),
    location: overrides.location ?? fn(null),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    tasks: overrides.tasks ?? fn([]),
    tags,
  };
  // tag_update.js reassigns name / status / allowsNextAction via JXA's
  // property-setter syntax. Use writable accessors so `target.x = y`
  // updates the value AND `target.x()` returns it via the callable getter.
  // Pass the override function (or default static getter) through directly
  // so throwing-getter overrides keep throwing until the script reassigns.
  defineWritableAccessor(tag, "name", overrides.name ?? fn(`Tag ${_tagSeq}`));
  defineWritableAccessor(tag, "status", overrides.status ?? fn("active"));
  defineWritableAccessor(tag, "allowsNextAction", overrides.allowsNextAction ?? fn(false));
  return tag;
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
  const now = new Date();
  // Children/subtasks: pushable callable so task_create.js's
  // `parent.tasks.push(newTask)` works. Honour custom `tags()` overrides
  // verbatim (slice 1 / 2 tests pass a static array there).
  const childrenArr: unknown[] = [];
  const childTasks = Object.assign(() => childrenArr, {
    push: (item: unknown) => childrenArr.push(item),
  });
  const attachmentsArr: unknown[] = [];
  const task: Record<string, unknown> = {
    id,
    containingProject: overrides.containingProject ?? throwing(),
    parentTask: overrides.parentTask ?? throwing(),
    tags: overrides.tags ?? fn([]),
    tasks: childTasks,
    repetitionRule: overrides.repetitionRule ?? fn(null),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    inInbox: overrides.inInbox ?? fn(false),
    completedByChildren: overrides.completedByChildren ?? fn(false),
    availabilityStatus: overrides.availabilityStatus ?? fn("available"),
    deferDateFloating: overrides.deferDateFloating ?? fn(false),
    dueDateFloating: overrides.dueDateFloating ?? fn(false),
    effectivelyAvailable: overrides.effectivelyAvailable ?? fn(true),
    blocked: overrides.blocked ?? fn(false),
    effectivelyDropped: overrides.effectivelyDropped ?? fn(false),
    numberOfTasks: overrides.numberOfTasks ?? fn(0),
    // attachment_add.js pushes new attachments onto `task.fileAttachments`.
    // Honour custom callable overrides verbatim — only the default path
    // gets push, which is enough for the slice-7 tests.
    fileAttachments: overrides.fileAttachments
      ? overrides.fileAttachments
      : Object.assign(() => attachmentsArr, {
          push: (item: unknown) => attachmentsArr.push(item),
        }),
    // task_delete.js calls `found.delete()` (instance method, not
    // ofApp.delete). task_duplicate copies tags via `to.addTag(tag)`.
    // task_move / task_reorder call `found.move({ to, positioned })`. All
    // are no-ops; assertions go via the script's return value.
    delete: () => {
      /* no-op for tests */
    },
    addTag: (_tag: unknown) => {
      /* no-op for tests */
    },
    move: (_args: unknown) => {
      /* no-op for tests */
    },
    // task_batch_complete.js calls `task.markComplete({completionDate})`
    // as a per-task instance method (distinct from the app-level verb).
    markComplete: (_args: unknown) => {
      /* no-op for tests */
    },
    // task_duplicate calls `cloneTask.make({new: "task", withProperties})`
    // when recursing into subtasks. Returning a fresh fake-task is enough
    // for the script to keep walking; tests assert the script's return
    // shape, not the produced subtree.
    make: (_args: unknown) => fakeTask({}),
  };
  // Mutation scripts (task_update / task_complete / task_drop) assign these
  // via JXA's property-setter syntax. Use writable accessors so the read
  // path through build_task.js sees the latest values.
  defineWritableAccessor(task, "name", overrides.name ?? fn(`Task ${_taskSeq}`));
  defineWritableAccessor(task, "note", overrides.note ?? fn(""));
  defineWritableAccessor(task, "flagged", overrides.flagged ?? fn(false));
  defineWritableAccessor(task, "deferDate", overrides.deferDate ?? fn(null));
  defineWritableAccessor(task, "dueDate", overrides.dueDate ?? fn(null));
  defineWritableAccessor(task, "completionDate", overrides.completionDate ?? fn(null));
  defineWritableAccessor(task, "dropped", overrides.dropped ?? fn(false));
  defineWritableAccessor(task, "completed", overrides.completed ?? fn(false));
  defineWritableAccessor(task, "estimatedMinutes", overrides.estimatedMinutes ?? fn(null));
  defineWritableAccessor(task, "sequential", overrides.sequential ?? fn(false));
  defineWritableAccessor(task, "containsSingletonActions", false);
  return task;
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
  const now = new Date();
  // task_create.js pushes new tasks onto `proj.tasks`; task_duplicate.js
  // calls `proj.make({ new: "task", withProperties })`. Honour custom
  // overrides verbatim — only the default path gets push/make.
  const tasksArr: unknown[] = [];
  const projectAttachmentsArr: unknown[] = [];
  const tasks = overrides.tasks
    ? overrides.tasks
    : Object.assign(() => tasksArr, {
        push: (item: unknown) => tasksArr.push(item),
        end: { __end: true },
      });
  const project: Record<string, unknown> = {
    id,
    containingFolder: overrides.containingFolder ?? throwing(),
    tasks,
    flattenedTasks: overrides.flattenedTasks ?? fn([]),
    numberOfTasks: overrides.numberOfTasks ?? fn(0),
    numberOfAvailableTasks: overrides.numberOfAvailableTasks ?? fn(0),
    completionCriterion: overrides.completionCriterion ?? fn("parallel"),
    sequential: overrides.sequential ?? fn(false),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
    reviewInterval: overrides.reviewInterval ?? fn(null),
    reviewIntervalDays: overrides.reviewIntervalDays ?? fn(null),
    effectiveStatus: overrides.effectiveStatus ?? fn("active"),
    lastReviewDate: overrides.lastReviewDate ?? fn(null),
    deferDateFloating: overrides.deferDateFloating ?? fn(false),
    dueDateFloating: overrides.dueDateFloating ?? fn(false),
    fileAttachments: overrides.fileAttachments
      ? overrides.fileAttachments
      : Object.assign(() => projectAttachmentsArr, {
          push: (item: unknown) => projectAttachmentsArr.push(item),
        }),
    // project_update / project_move call `target.move({to: ...})`. The
    // assertion is on the script's return value, not on the fake's
    // post-state, so move() is intentionally a no-op.
    move: (_args: unknown) => {
      /* no-op */
    },
    // task_duplicate.js calls `proj.make({ new: "task", withProperties })`
    // when the destination container is a project. Returns a fresh fake
    // task — the script just needs `.id()` callable for the return shape.
    make: (_args: unknown) => fakeTask({}),
  };
  // Mutation scripts assign these via JXA's property-setter syntax.
  // Use writable accessors so `target.x = y` updates the value AND
  // `target.x()` returns it via the callable getter.
  defineWritableAccessor(project, "name", overrides.name ?? fn(`Project ${_projectSeq}`));
  defineWritableAccessor(project, "note", overrides.note ?? fn(""));
  defineWritableAccessor(project, "status", overrides.status ?? fn("active"));
  defineWritableAccessor(project, "deferDate", overrides.deferDate ?? fn(null));
  defineWritableAccessor(project, "dueDate", overrides.dueDate ?? fn(null));
  defineWritableAccessor(project, "flagged", overrides.flagged ?? fn(false));
  defineWritableAccessor(project, "estimatedMinutes", overrides.estimatedMinutes ?? fn(null));
  defineWritableAccessor(project, "completionDate", overrides.completionDate ?? fn(null));
  defineWritableAccessor(project, "nextReviewDate", overrides.nextReviewDate ?? fn(null));
  return project;
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
  // `folders` is exposed as a callable that doubles as a push-target so
  // `parentFolder.folders.push(child)` works in mutation scripts. The
  // underlying array is captured from the override (or an empty list) at
  // construction time; subsequent push() calls mutate that array, and reads
  // via `folder.folders()` see the current contents.
  const childrenArr: unknown[] = overrides.folders ? Array.from(overrides.folders()) : [];
  const folders = Object.assign(() => childrenArr, {
    push: (item: unknown) => {
      childrenArr.push(item);
    },
  });
  const now = new Date();
  // project_create.js may push new projects into a folder via
  // `folder.projects.push(newProj)`, and project_update / project_move
  // pass `folder.projects.end` as a JXA move target. When a caller
  // overrides `projects` (commonly with a throwing getter to assert the
  // try/catch fallback in folder_delete) we honour that callable directly
  // — only the default path gets the push/end accessors. Tests that
  // exercise project mutations don't override `projects`.
  const projectsArr: unknown[] = [];
  const projects = overrides.projects
    ? overrides.projects
    : Object.assign(() => projectsArr, {
        push: (item: unknown) => {
          projectsArr.push(item);
        },
        end: { __end: true },
      });
  const folder: Record<string, unknown> = {
    id,
    container: overrides.container ?? throwing(),
    parent: overrides.parent ?? throwing(),
    folders,
    projects,
    note: overrides.note ?? fn(""),
    status: overrides.status ?? fn("active"),
    creationDate: overrides.creationDate ?? fn(now),
    modificationDate: overrides.modificationDate ?? fn(now),
  };
  // `name` is a writable accessor so folder_update.js's `target.name = "X"`
  // updates the value AND `target.name()` continues to return the latest
  // value via the getter — the JXA semantics build_folder.js relies on.
  // Default: invoke the supplied function once to seed the initial string.
  defineWritableNameAccessor(folder, (overrides.name ?? fn(`Folder ${_folderSeq}`))());
  return folder;
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
  /**
   * `attachment_save_to_path.js` calls `att.file()` to resolve the source
   * Path. Default returns a Path-like object whose `toString()` yields a
   * predictable POSIX path; override with `throwing()` to exercise the
   * "file not accessible" fallback.
   */
  file?: () => unknown;
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
    file: overrides.file ?? (() => ({ toString: () => "/tmp/fake-source.dat" })),
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
  const win: Record<string, unknown> = {};
  // perspectiveName is read-only on Window in JXA (window_get_state reads
  // it; window_set_perspective writes the separate `perspective` field).
  // Keep the function override for the read path.
  win.perspectiveName = overrides.perspectiveName ?? fn("Forecast");
  // window_set_focus.js assigns `w.focus = [target]`; build_..._for read
  // via `w.focus()`. window_set_perspective.js assigns `w.perspective = X`
  // (write-only). Use writable accessors for both.
  defineWritableAccessor(win, "focus", overrides.focus ?? fn([]));
  defineWritableAccessor(win, "perspective", null);
  return win;
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
