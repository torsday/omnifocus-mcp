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
  const fakeApp = buildFakeApp(document);

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

  return {
    flattenedTags: () => tags,
    flattenedTasks: () => tasks,
    flattenedProjects: () => projects,
    flattenedFolders: () => folders,
    // Some scripts access inbox tasks through the document
    inbox: {
      tasks: () => inboxTasks,
    },
    // Pass-through for scripts that check class() on the document itself
    class: () => "document",
  };
}

function buildFakeApp(document: ReturnType<typeof buildFakeDocument>) {
  return (_name: string) => ({
    // Scripts set this; we accept and ignore it.
    includeStandardAdditions: false,
    defaultDocument: document,
    inbox: document.inbox,
  });
}
