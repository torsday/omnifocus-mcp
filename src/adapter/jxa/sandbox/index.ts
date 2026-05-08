import { ScriptError } from "../../../errors/index.js";

/**
 * JXA sandbox runner — evaluates a JXA script body in a controlled Node.js
 * context so unit tests can assert control-flow and output shape without
 * OmniFocus or osascript.
 *
 * Design constraints:
 * - Scripts define `function run(argv)` at the top level; they are not ES
 *   modules and have no exports. We wrap them in an IIFE that captures a
 *   synthetic `Application` global, evaluates the script, and calls `run`.
 * - No real Apple Event bridge is created. The caller supplies fake OF
 *   entities via {@link SandboxDocument}.
 * - Errors thrown by the script body propagate to the caller unchanged —
 *   the sandbox does not catch them. This lets callers distinguish between
 *   "script threw" and "script returned an error JSON".
 *
 * @see src/adapter/jxa/sandbox/fixtures.ts — fake entity builders
 * @see src/scripts/jxa/ — the JXA script bodies under test
 */

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

/**
 * Minimal fake OmniFocus document passed to the sandbox.
 *
 * Callers populate only the collections the script under test reads.
 * Unset collections default to empty arrays.
 */
export interface SandboxDocument {
  /** Fake tags for `ofApp.defaultDocument.flattenedTags()`. */
  tags?: unknown[];
  /** Fake tasks for `ofApp.defaultDocument.flattenedTasks()`. */
  tasks?: unknown[];
  /** Fake inbox tasks for `ofApp.inbox.tasks()`. */
  inboxTasks?: unknown[];
  /** Fake projects for `ofApp.defaultDocument.flattenedProjects()`. */
  projects?: unknown[];
  /** Fake folders for `ofApp.defaultDocument.flattenedFolders()`. */
  folders?: unknown[];
  /** Fake windows for `ofApp.windows()`. */
  windows?: unknown[];
  /** Fake custom perspectives for `ofApp.perspectives()`. */
  perspectives?: unknown[];
}

// ---------------------------------------------------------------------------
// Predicate evaluator for `flattenedTasks.whose(...)`
// ---------------------------------------------------------------------------

type TaskRecord = Record<string, unknown> & { id?: () => string };

/**
 * Evaluate a single OmniFocus `whose()`-style predicate against one task.
 *
 * Supports the subset of operators the JXA scripts in this repo actually
 * use: equality on primitive properties, and `_lessThan` / `_lessThanEquals`
 * / `_greaterThan` / `_greaterThanEquals` on date-valued properties. This is
 * not a full reimplementation of OmniFocus's query DSL — anything else
 * silently fails open (the predicate matches), which surfaces as a test
 * failure rather than a silent miss.
 */
function matchesPredicate(task: TaskRecord, predicate: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(predicate)) {
    const getter = task[key];
    if (typeof getter !== "function") return false;
    const actual = (getter as () => unknown)();

    if (
      expected !== null &&
      typeof expected === "object" &&
      !(expected instanceof Date) &&
      !Array.isArray(expected)
    ) {
      const ops = expected as Record<string, unknown>;
      // OmniFocus's whose() never matches null or missing values against a
      // date-comparison operator — a task with no dueDate is not "less than"
      // any date. Mirror that: if actual isn't a Date the predicate fails.
      if (!(actual instanceof Date)) return false;
      const actualTime = actual.getTime();
      if ("_lessThan" in ops) {
        const bound = ops._lessThan;
        if (!(bound instanceof Date)) return false;
        if (!(actualTime < bound.getTime())) return false;
      }
      if ("_lessThanEquals" in ops) {
        const bound = ops._lessThanEquals;
        if (!(bound instanceof Date)) return false;
        if (!(actualTime <= bound.getTime())) return false;
      }
      if ("_greaterThan" in ops) {
        const bound = ops._greaterThan;
        if (!(bound instanceof Date)) return false;
        if (!(actualTime > bound.getTime())) return false;
      }
      if ("_greaterThanEquals" in ops) {
        const bound = ops._greaterThanEquals;
        if (!(bound instanceof Date)) return false;
        if (!(actualTime >= bound.getTime())) return false;
      }
      continue;
    }

    if (actual !== expected) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Evaluate a JXA script source string with a synthetic `Application` global
 * and invoke its `run(argv)` entry point.
 *
 * @param scriptSource - Raw JXA script source (the string imported via the
 *   scriptInliner loader, e.g. `import tagListScript from "../../scripts/jxa/tag_list.js"`).
 * @param args - The argument object the real transport would JSON-serialize
 *   into `argv[0]`. The runner handles the serialization.
 * @param doc - Fake OmniFocus collections the script will read.
 * @returns The parsed JSON result the script returned.
 * @throws If the script throws an uncaught exception.
 */
export function runJxaScriptInSandbox<T = unknown>(
  scriptSource: string,
  args: Record<string, unknown>,
  doc: SandboxDocument = {},
): T {
  const document = buildFakeDocument(doc);
  const fakeApp = buildFakeApp(document, doc);

  // Wrap the script in an IIFE that receives `Application` as a parameter,
  // then call `run(argv)` with the serialized args — matching how osascript
  // invokes the function with `argv` as a string array.
  const wrapper = `(function(Application) { ${scriptSource}; return run; })`;

  // biome-ignore lint/security/noGlobalEval: intentional — this module IS the sandbox; eval is the mechanism that injects a synthetic Application global into the script's scope without spawning osascript.
  const runFn = eval(wrapper)(fakeApp) as (argv: string[]) => string;

  const raw = runFn([JSON.stringify(args)]);
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Internal fake-app construction
// ---------------------------------------------------------------------------

function buildFakeDocument(doc: SandboxDocument) {
  const tags = doc.tags ?? [];
  const tasks = doc.tasks ?? [];
  const projects = doc.projects ?? [];
  const folders = doc.folders ?? [];
  const inboxTasks = doc.inboxTasks ?? [];

  // `flattenedTasks` is invoked both as `flattenedTasks()` (returns the
  // array) and as `flattenedTasks.whose(predicate)()` (returns a callable
  // wrapping the filtered subset). Functions are objects in JS, so we attach
  // `whose` directly to the function value.
  const flattenedTasks = Object.assign(() => tasks, {
    whose: (predicate: Record<string, unknown>) => {
      const filtered = (tasks as TaskRecord[]).filter((t) => matchesPredicate(t, predicate));
      return () => filtered;
    },
  });

  // `flattenedProjects` is invoked both as `flattenedProjects()` (returns the
  // array) and as `flattenedProjects.byId(id)` (returns a lazy specifier
  // whose `.id()` throws when the id is missing — `lookupOrThrow` relies on
  // exactly that "throw on .id()" contract to map the miss to a typed
  // NotFound error).
  const flattenedProjects = Object.assign(() => projects, {
    byId: (id: string) => {
      const hit = (projects as Array<{ id?: () => string }>).find(
        (p) => typeof p.id === "function" && p.id() === id,
      );
      if (hit) return hit;
      // Mirror OF's "errAENoSuchObject (-1728)" — lookupOrThrow catches the
      // throw and rethrows the typed `<Kind> not found: <id>` message.
      const msg = "Can't get object. (-1728)";
      return {
        id: () => {
          throw new ScriptError(msg, { details: { stderr: msg } });
        },
      };
    },
  });

  // Top-level folder collection. Mutation scripts push newly-constructed
  // folders here via `ofApp.defaultDocument.folders.push(newFolder)`. Test
  // assertions verify the script's return value rather than walking the
  // fake's collections, so we don't bother syncing flattenedFolders on push.
  // The collection also exposes `.byId(id)` because project_create.js
  // looks up folders that way for its parent-folder argument.
  const docFoldersArr: unknown[] = [];
  const docFolders = Object.assign(() => docFoldersArr, {
    push: (item: unknown) => docFoldersArr.push(item),
    byId: (id: string) => {
      const hit = (folders as Array<{ id?: () => string }>).find(
        (f) => typeof f.id === "function" && f.id() === id,
      );
      if (hit) return hit;
      const msg = "Can't get object. (-1728)";
      return {
        id: () => {
          throw new ScriptError(msg, { details: { stderr: msg } });
        },
      };
    },
  });

  // Top-level project collection. project_create.js pushes new projects
  // here OR into a folder's `.projects`. project_update / project_move use
  // `target.move({ to: ... .projects.end })`; the `.end` accessor is a
  // sentinel pointer the move() no-op ignores.
  const projectsArr: unknown[] = [...projects];
  const docProjects = Object.assign(() => projectsArr, {
    push: (item: unknown) => projectsArr.push(item),
    end: { __end: true },
  });

  // Top-level tag collection. tag_create.js pushes new tags here OR into an
  // existing parent tag's `.tags` collection. After push it re-fetches via
  // `flattenedTags.byId(id)`, so we need a flat-walk lookup that descends
  // into every tag's children — that way a tag pushed onto a parent's
  // children is still findable from the document.
  const topLevelTags: unknown[] = [...tags];
  const docTags = Object.assign(() => topLevelTags, {
    push: (item: unknown) => topLevelTags.push(item),
  });

  type TagNode = { id?: () => string; tags?: () => unknown[] };
  function walkTags(roots: unknown[]): unknown[] {
    const out: unknown[] = [];
    const stack = [...roots];
    while (stack.length) {
      const t = stack.pop() as TagNode;
      if (!t) continue;
      out.push(t);
      if (typeof t.tags === "function") {
        try {
          const children = t.tags();
          if (Array.isArray(children)) stack.push(...children);
        } catch {
          /* ignore — fakes that throw on .tags() shouldn't crash the walk */
        }
      }
    }
    return out;
  }

  const flattenedTags = Object.assign(() => walkTags(topLevelTags), {
    byId: (id: string) => {
      const hit = (walkTags(topLevelTags) as Array<{ id?: () => string }>).find(
        (t) => typeof t.id === "function" && t.id() === id,
      );
      if (hit) return hit;
      const msg = "Can't get object. (-1728)";
      return {
        id: () => {
          throw new ScriptError(msg, { details: { stderr: msg } });
        },
      };
    },
  });

  return {
    flattenedTags,
    tags: docTags,
    flattenedTasks,
    flattenedProjects,
    projects: docProjects,
    flattenedFolders: () => folders,
    folders: docFolders,
    // Some scripts access inbox tasks through the document
    inbox: {
      tasks: () => inboxTasks,
    },
    // Pass-through for scripts that check class() on the document itself
    class: () => "document",
  };
}

function buildFakeApp(document: ReturnType<typeof buildFakeDocument>, doc: SandboxDocument) {
  const windows = doc.windows ?? [];
  const perspectives = doc.perspectives ?? [];
  // Track mutation-side effects so tests can assert post-condition without
  // shimming `delete` to actually mutate the fake document. Scripts only
  // care that delete() didn't throw.
  const deleted: unknown[] = [];

  // `ofApp.Folder({ name })` is the JXA constructor folder_create.js uses.
  // It returns a fresh fake folder; the script then push()es it into the
  // parent's folders collection. The constructed folder honours the same
  // contract as `fakeFolder()` (name(), id(), parent(), folders(), …) so
  // build_folder.js can build a domain Folder from it without surprises.
  const folderConstructor = (opts: { name?: string } = {}) => makeConstructedFolder(opts);
  // `ofApp.Tag({ name })` is the JXA constructor tag_create.js uses. Same
  // contract as fakeTag(): build_tag.js reads name(), id(), parent(),
  // status(), creationDate(), modificationDate(), allowsNextAction(),
  // tasks().length, location(). The constructed tag installs writable
  // accessors on `name`, `status`, `allowsNextAction` since tag_update.js
  // reassigns those.
  const tagConstructor = (opts: { name?: string } = {}) => makeConstructedTag(opts);
  // `ofApp.Project(props)` is the JXA constructor project_create.js uses.
  // The script passes name plus any provided fields (note, deferDate,
  // dueDate, estimatedMinutes, flagged, status). The returned fake honours
  // the build_project.js read surface and exposes writable accessors on
  // every field project_update.js can reassign.
  const projectConstructor = (props: ProjectConstructorOpts = {}) => makeConstructedProject(props);

  // `markComplete` / `markDropped` / `markReviewed` are app-level verbs the
  // JXA scripts call instead of property assignment. Track invocations so
  // tests can assert the script took the right path; the call itself does
  // nothing else (project state is asserted via the script's return value).
  const markedComplete: unknown[] = [];
  const markedDropped: unknown[] = [];
  const markedReviewed: unknown[] = [];

  return (_name: string) => ({
    // Scripts set this; we accept and ignore it.
    includeStandardAdditions: false,
    defaultDocument: document,
    inbox: document.inbox,
    windows: () => windows,
    perspectives: () => perspectives,
    Folder: folderConstructor,
    Tag: tagConstructor,
    Project: projectConstructor,
    delete: (target: unknown) => {
      deleted.push(target);
    },
    markComplete: (target: unknown) => {
      markedComplete.push(target);
    },
    markDropped: (target: unknown) => {
      markedDropped.push(target);
    },
    markReviewed: (target: unknown) => {
      markedReviewed.push(target);
    },
    /** Test-only — surface what `ofApp.delete()` was called with. */
    _deleted: deleted,
    _markedComplete: markedComplete,
    _markedDropped: markedDropped,
    _markedReviewed: markedReviewed,
  });
}

let _constructedFolderSeq = 0;

/**
 * Build a fake JXA Folder created via `ofApp.Folder({ name })`. The shape
 * mirrors `fakeFolder()` but only the fields the JXA scripts read or
 * mutate are populated. `name` is a writable accessor (Object.defineProperty
 * getter+setter) so `target.name = "X"` updates the value AND `target.name()`
 * still returns the latest value via the getter — the JXA semantics
 * folder_update.js relies on.
 */
function makeConstructedFolder(opts: { name?: string }): Record<string, unknown> {
  const id = `constructed_folder_${++_constructedFolderSeq}`;
  const childrenArr: unknown[] = [];
  const folders = Object.assign(() => childrenArr, {
    push: (item: unknown) => childrenArr.push(item),
  });
  const noThrow = () => {
    throw new ScriptError("Can't get object.", { details: { stderr: "Can't get object." } });
  };
  const folder: Record<string, unknown> = {
    id: () => id,
    parent: noThrow,
    folders,
    projects: () => [],
    creationDate: () => new Date(),
    modificationDate: () => new Date(),
  };
  defineWritableNameAccessor(folder, opts.name ?? `Folder ${_constructedFolderSeq}`);
  return folder;
}

let _constructedTagSeq = 0;

/**
 * Build a fake JXA Tag created via `ofApp.Tag({ name })`. The shape mirrors
 * `fakeTag()` but only the fields tag scripts read or mutate are populated.
 * `name`, `status`, and `allowsNextAction` are writable accessors so
 * tag_update.js's `target.<key> = X` assignments persist.
 */
function makeConstructedTag(opts: { name?: string }): Record<string, unknown> {
  const id = `constructed_tag_${++_constructedTagSeq}`;
  const childrenArr: unknown[] = [];
  const childTags = Object.assign(() => childrenArr, {
    push: (item: unknown) => childrenArr.push(item),
  });
  const noThrow = () => {
    throw new ScriptError("Can't get object.", { details: { stderr: "Can't get object." } });
  };
  const tag: Record<string, unknown> = {
    id: () => id,
    parent: noThrow,
    tags: childTags,
    location: () => null,
    creationDate: () => new Date(),
    modificationDate: () => new Date(),
    tasks: () => [],
  };
  defineWritableAccessor(tag, "name", opts.name ?? `Tag ${_constructedTagSeq}`);
  defineWritableAccessor(tag, "status", "active");
  defineWritableAccessor(tag, "allowsNextAction", false);
  return tag;
}

/**
 * Per-property opts accepted by `ofApp.Project({...})`. The JXA constructor
 * itself accepts more, but project_create.js only forwards these.
 */
export interface ProjectConstructorOpts {
  name?: string;
  note?: string;
  deferDate?: Date;
  dueDate?: Date;
  estimatedMinutes?: number;
  flagged?: boolean;
  status?: string;
}

let _constructedProjectSeq = 0;

/**
 * Build a fake JXA Project created via `ofApp.Project({ name, ... })`.
 * Mirrors the read surface of `fakeProject()` (so `build_project.js` can
 * walk it) and installs writable accessors on every field that
 * project_update / project_set_*  / project_drop / project_complete
 * scripts may assign.
 */
function makeConstructedProject(opts: ProjectConstructorOpts): Record<string, unknown> {
  const id = `constructed_project_${++_constructedProjectSeq}`;
  const tasksArr: unknown[] = [];
  const tasks = Object.assign(() => tasksArr, {
    push: (item: unknown) => tasksArr.push(item),
    end: { __end: true },
  });
  const noThrow = () => {
    throw new ScriptError("Can't get object.", { details: { stderr: "Can't get object." } });
  };
  const project: Record<string, unknown> = {
    id: () => id,
    folder: noThrow,
    containingFolder: noThrow,
    tasks,
    flattenedTasks: () => tasksArr,
    creationDate: () => new Date(),
    modificationDate: () => new Date(),
    completionCriterion: () => "parallel",
    sequential: () => false,
    numberOfTasks: () => 0,
    numberOfAvailableTasks: () => 0,
    reviewInterval: () => null,
    effectiveStatus: () => "active",
    move: (_args: unknown) => {
      /* no-op for tests; assertions go via the script's return value */
    },
  };
  defineWritableAccessor(project, "name", opts.name ?? `Project ${_constructedProjectSeq}`);
  defineWritableAccessor(project, "note", opts.note ?? "");
  defineWritableAccessor(project, "status", opts.status ?? "active");
  defineWritableAccessor(project, "deferDate", opts.deferDate ?? null);
  defineWritableAccessor(project, "dueDate", opts.dueDate ?? null);
  defineWritableAccessor(project, "flagged", opts.flagged ?? false);
  defineWritableAccessor(project, "estimatedMinutes", opts.estimatedMinutes ?? null);
  defineWritableAccessor(project, "completionDate", null);
  defineWritableAccessor(project, "nextReviewDate", null);
  defineWritableAccessor(project, "lastReviewDate", null);
  defineWritableAccessor(project, "reviewIntervalDays", null);
  return project;
}

/**
 * Define a writable JXA-style accessor: `obj[key] = X` updates the value
 * and `obj[key]()` reads the latest value via a callable getter. Used by
 * mutation scripts that assign to properties (`target.name = "X"`,
 * `target.status = "on hold"`, …) and then read them back through
 * `build_*.js` helpers via zero-arg method calls.
 *
 * The initial value can be a static value or a getter function. Passing a
 * function preserves its behavior — including throwing — until the script
 * reassigns the property. That matches existing fixture overrides like
 * `fakeTag({ allowsNextAction: throwing() })` which must still throw on
 * read until tag_update.js's `target.allowsNextAction = true` rebinds it.
 */
export function defineWritableAccessor(
  obj: Record<string, unknown>,
  key: string,
  initial: unknown,
): void {
  let getter: () => unknown =
    typeof initial === "function" ? (initial as () => unknown) : () => initial;
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get: () => getter,
    set: (value: unknown) => {
      getter = typeof value === "function" ? (value as () => unknown) : () => value;
    },
  });
}

/**
 * Back-compat shim: slice 3 introduced a name-only accessor. Keep the same
 * surface so the folder fixture's import doesn't churn while the generic
 * helper above replaces it under the hood.
 */
export function defineWritableNameAccessor(obj: Record<string, unknown>, initial: string): void {
  defineWritableAccessor(obj, "name", initial);
}
