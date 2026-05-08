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

  return {
    flattenedTags: () => tags,
    flattenedTasks,
    flattenedProjects,
    flattenedFolders: () => folders,
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
  return (_name: string) => ({
    // Scripts set this; we accept and ignore it.
    includeStandardAdditions: false,
    defaultDocument: document,
    inbox: document.inbox,
    windows: () => windows,
    perspectives: () => perspectives,
  });
}
