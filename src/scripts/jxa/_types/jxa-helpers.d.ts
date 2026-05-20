// Hand-maintained declarations for the inlined JXA helpers under
// `_helpers/`.
//
// Sibling of `omnifocus.d.ts` (sdef-derived) and `jxa-globals.d.ts`
// (JXA runtime). These declarations describe symbols that are *not*
// part of any script's own source — they're spliced into every
// consumer at build time by the `scriptInlinerPlugin` (ADR-0020).
// Because the splice happens after `tsc` sees the file,
// `// @ts-check` consumers report `TS2304: Cannot find name 'buildTask'`
// without this reference.
//
// Closes category (3) of #994: previously each consumer had to carry
// a per-script `@type {…}` JSDoc declaration for every helper it
// inlined (see the old shape in task_get.js, pre-#998). Centralizing
// here means new opt-ins reference one `.d.ts` line instead of
// stamping declarations into every consumer.
//
// JXA scripts opt in via:
//
//   // @ts-check
//   /// <reference path="_types/omnifocus.d.ts" />
//   /// <reference path="_types/jxa-globals.d.ts" />
//   /// <reference path="_types/jxa-helpers.d.ts" />
//
// Ambient (script-mode) — no `export`. Adding one would make the file
// a module and the declarations would disappear from consumer scope.
//
// Signatures are conservatively typed: inputs are the JXA specifiers
// the helpers actually receive (`unknown` keeps the call site honest),
// and returns are documented as the projected domain shape but typed
// as `object` so consumers can JSON.stringify the result without
// claiming a specific Task / Folder / etc. shape (the projection logic
// inside each helper is the source of truth for the shape, not this
// file).
//
// @see src/scripts/jxa/_helpers/*.js — runtime sources

/**
 * Build the canonical projected Task shape from a JXA task specifier.
 * Spliced into consumers via `// @inline _helpers/build_task.js`.
 *
 * @see src/scripts/jxa/_helpers/build_task.js
 */
declare function buildTask(task: unknown, options?: { effectiveAvailability?: boolean }): object;

/**
 * Build the repetition sub-object of a Task (rrule + anchor +
 * scheduleType). Spliced alongside `buildTask` via
 * `// @inline _helpers/build_task.js`.
 */
declare function buildRepetition(task: unknown): object | null;

/**
 * Build the canonical projected Folder shape from a JXA folder specifier.
 * Spliced via `// @inline _helpers/build_folder.js`.
 */
declare function buildFolder(folder: unknown, options?: object): object;

/**
 * Build the canonical projected Project shape from a JXA project specifier.
 * Spliced via `// @inline _helpers/build_project.js`.
 */
declare function buildProject(proj: unknown): object;

/**
 * Build the canonical projected Tag shape from a JXA tag specifier.
 * `docId` is the OmniFocus default-document id, used to distinguish
 * top-level tags (container is the document) from nested tags.
 * Spliced via `// @inline _helpers/build_tag.js`.
 */
declare function buildTag(tag: unknown, docId: string): object;

/**
 * Force a JXA `byId(...)` lookup and throw a structured
 * `<kindLabel> not found: <idValue>` error if the id doesn't exist.
 * JXA's `byId` returns a lazy specifier (#674); calling `.id()` here
 * forces resolution. Spliced via `// @inline _helpers/lookup_or_throw.js`.
 *
 * @see src/scripts/jxa/_helpers/lookup_or_throw.js
 */
declare function lookupOrThrow<T = unknown>(specifier: T, kindLabel: string, idValue: string): T;
