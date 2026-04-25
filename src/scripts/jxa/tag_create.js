/**
 * JXA: create a tag, optionally under a parent tag.
 *
 * Args (argv[0] JSON): { name: string, parentId?: string }
 * Returns JSON: { tag: Tag }
 *
 * @see src/adapter/jxa/JxaTransport.ts — caller
 * @see src/domain/tag.ts — Tag domain type
 */

// biome-ignore lint/correctness/noUnusedVariables: osascript invokes run(argv) by convention.
function run(argv) {
  const args = JSON.parse(argv[0]);
  const ofApp = Application("OmniFocus");
  ofApp.includeStandardAdditions = false;

  function buildTag(tag) {
    let parentId = null;
    try {
      const p = tag.parent();
      if (p && p.class() !== "document") parentId = p.id();
    } catch (_e) {}

    let location = null;
    try {
      const loc = tag.location();
      if (loc) {
        location = {
          name: loc.locationName ? loc.locationName() : null,
          latitude: loc.latitude(),
          longitude: loc.longitude(),
          radiusMeters: loc.radius ? loc.radius() : 0,
          trigger: "both",
        };
      }
    } catch (_e) {}

    let rawStatus = "active";
    try {
      rawStatus = tag.status();
    } catch (_e) {}
    const status = rawStatus === "on hold" ? "on-hold" : rawStatus;

    return {
      id: tag.id(),
      name: tag.name(),
      parentId: parentId,
      status: status,
      location: location,
      allowsNextAction: tag.allowsNextAction ? tag.allowsNextAction() : false,
      taskCount: tag.tasks ? tag.tasks().length : 0,
      createdAt: tag.creationDate ? tag.creationDate().toISOString() : new Date().toISOString(),
      modifiedAt: tag.modificationDate
        ? tag.modificationDate().toISOString()
        : new Date().toISOString(),
    };
  }

  let newTag;
  if (args.parentId) {
    const allTags = ofApp.defaultDocument.flattenedTags();
    let parentTag = null;
    for (let i = 0; i < allTags.length; i++) {
      if (allTags[i].id() === args.parentId) {
        parentTag = allTags[i];
        break;
      }
    }
    if (!parentTag) throw new Error(`Parent tag not found: ${args.parentId}`);
    // OmniFocus 4.x rejects `ofApp.make({ new: "tag", at: ... })` with
    // error -1728 (errAENoSuchObject). Use the specifier-push pattern instead.
    newTag = ofApp.Tag({ name: args.name });
    parentTag.tags.push(newTag);
  } else {
    // Same fix for document-level tag creation.
    newTag = ofApp.Tag({ name: args.name });
    ofApp.defaultDocument.tags.push(newTag);
  }

  return JSON.stringify({ tag: buildTag(newTag) });
}
