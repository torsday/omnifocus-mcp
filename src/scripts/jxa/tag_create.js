/**
 * JXA: create a tag, optionally under a parent tag.
 *
 * Args (argv[0] JSON): { name: string, parentId?: string }
 * Returns JSON: { tag: Tag }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/tag.ts — Tag domain type
 */

/** @param {string[]} argv — argv[0] is the JSON-encoded input payload. */
// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  // @inline _helpers/build_tag.js

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }

  // OmniFocus 4.x rejects ofApp.make({ new: "tag", at: ..., withProperties })
  // with error -10024. Use the Tag(props)+push pattern (mirrors task_create
  // fix in #331 and project/folder/tag fix in #319).
  const doc = ofApp.defaultDocument;

  // @inline _helpers/lookup_or_throw.js

  let newTag;
  if (args.parentId) {
    const parentTag = lookupOrThrow(
      doc.flattenedTags.byId(args.parentId),
      "Parent tag",
      args.parentId,
    );
    newTag = ofApp.Tag({ name: args.name });
    parentTag.tags.push(newTag);
  } else {
    newTag = ofApp.Tag({ name: args.name });
    doc.tags.push(newTag);
  }

  // Re-fetch via a stable specifier before calling buildTag.
  // After push(), property accesses (status(), creationDate(), etc.) on the
  // pushed specifier throw -1728 until the JXA bridge flushes deferred events.
  // .id() is safe immediately; all other properties require re-fetch.
  const tagId = newTag.id();
  const docId = doc.id();
  const fetchedTag = doc.flattenedTags.byId(tagId);
  return JSON.stringify({ tag: buildTag(fetchedTag, docId) });
}
