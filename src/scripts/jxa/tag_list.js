/**
 * JXA: list all tags, optionally filtered by parentId or status.
 *
 * Args (argv[0] JSON): { parentId?: string, status?: string }
 * Returns JSON: { tags: Tag[] }
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

  const allTags = ofApp.defaultDocument.flattenedTags();
  const result = [];

  for (let i = 0; i < allTags.length; i++) {
    const tag = allTags[i];
    const built = buildTag(tag);

    if (args.parentId !== undefined && built.parentId !== args.parentId) continue;
    if (args.status !== undefined && built.status !== args.status) continue;

    result.push(built);
  }

  return JSON.stringify({ tags: result });
}
