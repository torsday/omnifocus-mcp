// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: list all attachments on a task or project.
 *
 * Args (argv[0] JSON): { taskId?: string, projectId?: string }
 * Exactly one of taskId / projectId must be provided.
 *
 * Returns JSON: { attachments: Attachment[] }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/attachment.ts — Attachment domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;
  const doc = ofApp.defaultDocument;

  // @inline _helpers/lookup_or_throw.js

  function findOwner() {
    // byId() instead of flattenedX() linear scans (#788/#1087); lookupOrThrow
    // throws the same "<Kind> not found: <id>" on a missing id.
    if (args.taskId) {
      return lookupOrThrow(doc.flattenedTasks.byId(args.taskId), "Task", args.taskId);
    }
    if (args.projectId) {
      return lookupOrThrow(doc.flattenedProjects.byId(args.projectId), "Project", args.projectId);
    }
    throw new Error("One of taskId or projectId is required");
  }

  /** @param {Attachment} att — a FileAttachment specifier off the owner. */
  function buildAttachment(att) {
    let name = "";
    try {
      name = att.name();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let mimeType = null;
    try {
      const m = att.fileType();
      if (m) mimeType = m;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let sizeBytes = null;
    try {
      const sz = att.fileSize();
      if (sz != null) sizeBytes = sz;
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    let addedAt = new Date().toISOString();
    try {
      const cd = att.creationDate();
      if (cd) addedAt = cd.toISOString();
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    // OmniFocus attachments: linked() === true means alias, false means embedded
    let kind = "embedded";
    try {
      if (att.linked?.()) kind = "alias";
    } catch (_e) {
      /* OF 4.x: property access may not exist on all object types — default used */
    }

    return {
      id: att.id(),
      name: name,
      mimeType: mimeType,
      sizeBytes: sizeBytes,
      addedAt: addedAt,
      kind: kind,
    };
  }

  const owner = findOwner();
  const atts = owner.fileAttachments();
  const result = [];
  for (let i = 0; i < atts.length; i++) {
    result.push(buildAttachment(atts[i]));
  }

  return JSON.stringify({ attachments: result });
}
