/**
 * JXA: fetch multiple tags by IDs.
 *
 * Args (argv[0] JSON): { ids: string[] }
 * Returns JSON: { tags: (Tag | null)[] }
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

  const idSet = {};
  for (let i = 0; i < args.ids.length; i++) {
    idSet[args.ids[i]] = null;
  }

  const allTags = ofApp.defaultDocument.flattenedTags();
  for (let i = 0; i < allTags.length; i++) {
    const tid = allTags[i].id();
    if (Object.hasOwn(idSet, tid)) {
      idSet[tid] = buildTag(allTags[i]);
    }
  }

  const results = [];
  for (let i = 0; i < args.ids.length; i++) {
    results.push(idSet[args.ids[i]]);
  }

  return JSON.stringify({ tags: results });
}
