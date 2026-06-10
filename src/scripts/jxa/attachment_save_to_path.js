// @ts-check
/// <reference path="_types/omnifocus.d.ts" />
/// <reference path="_types/jxa-globals.d.ts" />
/// <reference path="_types/sdef-overrides.d.ts" />

/**
 * JXA: copy an attachment's content to a local file path.
 *
 * Args (argv[0] JSON): { taskId?: string, projectId?: string, attachmentId: string, destPath: string }
 * Exactly one of taskId / projectId must be provided.
 *
 * Returns JSON: { saved: true, path: string, sizeBytes: number }
 *
 * Uses the ObjC bridge (NSFileManager) for reliable binary-safe file copy and
 * size reporting — avoids shell escaping issues that plague doShellScript.
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  ObjC.import("Foundation");

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

  const owner = findOwner();
  const atts = owner.fileAttachments();
  let found = null;
  for (let i = 0; i < atts.length; i++) {
    if (atts[i].id() === args.attachmentId) {
      found = atts[i];
      break;
    }
  }
  if (!found) {
    throw new Error(`Attachment not found: ${args.attachmentId}`);
  }

  // Resolve the source path from the attachment's file property
  let srcPath;
  try {
    const f = found.file();
    // JXA Path objects expose toString() as the POSIX path
    srcPath = f.toString();
  } catch (_e) {
    throw new Error(
      `Attachment file is not accessible (may be an alias to a missing file): ${args.attachmentId}`,
    );
  }

  const fm = $.NSFileManager.defaultManager;
  const destPath = args.destPath;

  // Remove an existing destination FILE so copy doesn't fail with "file
  // exists" — but never a directory: removeItemAtPath deletes directories
  // RECURSIVELY, so a directory destPath (a natural "save into this folder"
  // mistake) would wipe the whole tree. destPath is documented as a file
  // path; an existing directory is a caller error. attributesOfItemAtPath
  // returns a nil proxy (`.js` undefined) when the path does not exist.
  const statErr = $();
  const destAttrs = fm.attributesOfItemAtPathError($(destPath), statErr);
  if (destAttrs?.js) {
    const destType = ObjC.unwrap(destAttrs.objectForKey($.NSFileType));
    if (String(destType) === "NSFileTypeDirectory") {
      throw new Error(
        `OF_VALIDATION: destPath is an existing directory (${destPath}); ` +
          "a full file path including the target filename is required — " +
          "directories are never deleted or overwritten",
      );
    }
    const removeErr = $();
    fm.removeItemAtPathError($(destPath), removeErr);
    // ignore removal errors — copy will surface any real problem
  }

  const errPtr = $();
  const ok = fm.copyItemAtPathToPathError($(srcPath), $(destPath), errPtr);
  if (!ok) {
    const msg = ObjC.unwrap(errPtr.localizedDescription) || "unknown error";
    throw new Error(`Failed to copy attachment to ${destPath}: ${msg}`);
  }

  // Stat the written file for sizeBytes
  let sizeBytes = 0;
  try {
    const attrsErr = $();
    const attrs = fm.attributesOfItemAtPathError($(destPath), attrsErr);
    if (attrs?.js) {
      const sz = ObjC.unwrap(attrs.objectForKey($.NSFileSize));
      if (sz != null) sizeBytes = Number(sz);
    }
  } catch (_e) {
    // Best effort — size may be unavailable
  }

  return JSON.stringify({ saved: true, path: destPath, sizeBytes: sizeBytes });
}
