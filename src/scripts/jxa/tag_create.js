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
      // Guard against "Can't get object." thrown when invoking these — see #498.

      createdAt: (function () { try { return tag.creationDate().toISOString(); } catch (_e) { return new Date().toISOString(); } })(),

      modifiedAt: (function () { try { return tag.modificationDate().toISOString(); } catch (_e) { return new Date().toISOString(); } })(),
    };
  }

  if (!args.name || args.name.trim() === "") {
    throw new Error("ValidationError: name is required and cannot be empty");
  }

  // OmniFocus 4.x rejects ofApp.make({ new: "tag", at: ..., withProperties })
  // with error -10024. Use the Tag(props)+push pattern (mirrors task_create
  // fix in #331 and project/folder/tag fix in #319).
  const doc = ofApp.defaultDocument;
  let newTag;
  if (args.parentId) {
    const parentTag = doc.flattenedTags.byId(args.parentId);
    if (!parentTag) throw new Error(`Parent tag not found: ${args.parentId}`);
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
  const fetchedTag = doc.flattenedTags.byId(tagId);
  return JSON.stringify({ tag: buildTag(fetchedTag) });
}
