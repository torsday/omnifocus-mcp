// Hand-maintained JXA runtime globals.
//
// Companion to the auto-generated `omnifocus.d.ts`. The OmniFocus type
// interfaces are derived from `vendor/OmniFocus.sdef`; this file declares
// the runtime entrypoints (`Application`, `Path`, `delay`, etc.) that
// `osascript -l JavaScript` exposes implicitly.
//
// JXA scripts opt in via:
//
//   // @ts-check
//   /// <reference path="_types/omnifocus.d.ts" />
//   /// <reference path="_types/jxa-globals.d.ts" />
//
// Keep this file small and rarely-touched. If you find yourself adding
// non-trivial JXA primitives here, consider whether the generator should
// emit them instead (e.g. via the sdef's `<command>` blocks).
//
// @see https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/Introduction.html

/**
 * The JXA `Application(...)` global. Returns a typed handle to the named
 * application. Most callers pass `"OmniFocus"` and use the
 * `Application` interface from `omnifocus.d.ts`. The runtime resolves
 * `Application.currentApplication()` for the calling process, but JXA
 * scripts spawned by `osascript -l JavaScript` rarely need that path.
 *
 * `Application("OmniFocus")` is mutated at runtime — `includeStandardAdditions`
 * is settable on the handle (per `task_get.js` and friends). The base
 * `Application` interface from the sdef doesn't model that side; declare
 * it here as an intersection so consumers can still assign.
 */
declare function Application(name: string): Application & {
  includeStandardAdditions: boolean;
  /**
   * Sdef `<property>` blocks become parameterless methods in the generated
   * `Application` interface (`defaultDocument(): Document`). Every script in
   * this repo accesses it as a property (`ofApp.defaultDocument.flattenedTasks()`)
   * — both the JXA runtime and the sandbox mock (`src/adapter/jxa/sandbox/`)
   * model it that way. Add a property override here so `// @ts-check`
   * consumers can use either form; intersection with the method signature
   * means callers may still write `ofApp.defaultDocument()` if they prefer.
   */
  defaultDocument: Document;
  /** Standard JXA constructor proxy — used to instantiate Tag/Folder/Project/Task by name. */
  Tag: new (props: {
    name: string;
    [key: string]: unknown;
  }) => unknown;
  Folder: new (props: { name: string; [key: string]: unknown }) => unknown;
  Project: new (props: { name: string; status?: unknown; [key: string]: unknown }) => unknown;
  InboxTask: new (props: { name: string; [key: string]: unknown }) => unknown;
  Task: new (props: { name: string; [key: string]: unknown }) => unknown;
  /** Send-event wrapper used by some OF commands. */
  add: (item: unknown, options: { to: unknown }) => void;
  /** Evaluate an OmniJS expression inside the OmniFocus host (#960 / #962). */
  evaluateJavascript: (source: string) => string;
  /**
   * Standard JXA `activate()` — brings the application to the foreground.
   * Used by `app_launch.js` after spawning OmniFocus. Available on every
   * JXA Application handle, not just OmniFocus, so it lives in the global
   * intersection. Returns void at runtime.
   */
  activate: () => void;
  /**
   * `processes` belongs to System Events, exposed via
   * `Application("System Events").processes.whose({ name: "OmniFocus" })()`.
   * Returning it from the generic Application intersection is broad-but-correct:
   * it never resolves on OmniFocus, so a stray access there would fail at
   * runtime anyway. The `whose(filter)` query returns a thunk that, when
   * called, yields the matching specifiers — conservatively typed as
   * `unknown[]` since the script only checks `.length` (`app_launch.js`).
   */
  processes: {
    whose(filter: Record<string, unknown>): () => unknown[];
  };
};

/**
 * The JXA `delay(seconds)` global. Blocks the script for the given
 * number of seconds. Rarely used in this codebase (most waits happen in
 * Node via the `_shared/spawnFloor` or retry-policy paths), but
 * available to scripts that need to coordinate with sync.
 */
declare function delay(seconds: number): void;

/**
 * The JXA `Path(pathString)` global — wraps a POSIX path for use with
 * file-handling AppleScript commands. Used by attachment scripts.
 */
declare function Path(pathString: string): unknown;

/**
 * The JXA `ObjC.import(...)` global — bridges to Foundation. Used by
 * the few JXA scripts that need NSDate / NSURL machinery. Returns
 * `unknown` because the imported namespace surface is opaque from
 * TypeScript's POV.
 */
declare const ObjC: {
  import(module: string): void;
  unwrap<T = unknown>(obj: unknown): T;
  deepUnwrap<T = unknown>(obj: unknown): T;
};

/**
 * The JXA `$.NS…` Objective-C bridge entrypoint. Only present after
 * `ObjC.import('Foundation')` runs. Typed as plain `any` (rather than
 * `{ [key: string]: any }`) because the Foundation surface is mostly
 * used as `$.NSURL(path).fileURLWithPath_(…)` — chained callable proxies.
 * The keyed-index form lets you read a member but the resulting value's
 * call-signature isn't preserved by TypeScript, which trips a
 * `TS2349: This expression is not callable.` on every `$.NSFoo(...)` site.
 * `any` short-circuits that without forcing every consumer to model
 * Foundation. We accept the lost intellisense in exchange for letting
 * `// @ts-check` scripts compile (`attachment_save_to_path.js` etc.).
 */
// biome-ignore lint/suspicious/noExplicitAny: Foundation bridge is intentionally untyped — see comment above.
declare const $: any;
