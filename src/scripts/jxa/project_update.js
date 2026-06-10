// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/jxa-helpers.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

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

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_project.js
  // @inline _helpers/lookup_or_throw.js

  // byId() instead of a flattenedProjects() linear scan (#788/#1091).
  const target = lookupOrThrow(
    ofApp.defaultDocument.flattenedProjects.byId(args.id),
    "Project",
    args.id,
  );

  if (args.name !== undefined) target.name = args.name;
  if (args.note !== undefined) target.note = args.note ?? "";
  if (args.noteHtml !== undefined) {
    // noteHtml is a runtime extra (see _types/sdef-overrides.d.ts) — the
    // setter accepts an HTML fragment and replaces the rich note. Null
    // clears the note, mirroring the plain-text `note` branch above.
    target.noteHtml = args.noteHtml ?? "";
  }
  if (args.flagged !== undefined) target.flagged = args.flagged;
  // Null clears the estimate (OF stores null, not 0, for "no estimate") —
  // mirrors task_update.js, which assigns null directly.
  if (args.estimatedMinutes !== undefined) target.estimatedMinutes = args.estimatedMinutes;
  if (args.deferDate !== undefined)
    // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
    target.deferDate = args.deferDate ? new Date(args.deferDate) : null;
  // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
  if (args.dueDate !== undefined) target.dueDate = args.dueDate ? new Date(args.dueDate) : null;
  if (args.status !== undefined) {
    // OmniFocus 4.8.8+ silently no-ops `target.status = "on hold"` (without
    // the " status" suffix). The verbose form is required for assignment
    // even though reads return the verbose form too. Map both wire values
    // to their suffixed JXA equivalents. Note: only "active" and "on-hold"
    // are valid here — the wire contract excludes "done" / "dropped",
    // which JXA refuses anyway and which use markComplete / markDropped
    // verbs instead.
    const jxaStatus = args.status === "on-hold" ? "on hold status" : "active status";
    // @ts-expect-error JXA accepts property-setter form on sdef properties; see _types/sdef-overrides.d.ts.
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
