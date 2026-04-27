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

    // creationDate/modificationDate are present as functions on every Tag, but
    // invoking them throws "Can't get object." for tags that lack the
    // timestamp in the document — see #498. Truthiness on the property
    // reference is not enough; we have to guard the call.
    let createdAt;
    try {
      createdAt = tag.creationDate().toISOString();
    } catch (_e) {
      createdAt = new Date().toISOString();
    }
    let modifiedAt;
    try {
      modifiedAt = tag.modificationDate().toISOString();
    } catch (_e) {
      modifiedAt = new Date().toISOString();
    }

    let allowsNextAction = false;
    try {
      allowsNextAction = tag.allowsNextAction();
    } catch (_e) {}

    let taskCount = 0;
    try {
      taskCount = tag.tasks().length;
    } catch (_e) {}

    return {
      id: tag.id(),
      name: tag.name(),
      parentId: parentId,
      status: status,
      location: location,
      allowsNextAction: allowsNextAction,
      taskCount: taskCount,
      createdAt: createdAt,
      modifiedAt: modifiedAt,
    };
  }

  const allTags = ofApp.defaultDocument.flattenedTags();
  const result = [];

  for (let i = 0; i < allTags.length; i++) {
    const tag = allTags[i];
    const built = buildTag(tag);

    // JxaTransport sends `parentId: null` / `status: null` for "no filter"
    // (rather than omitting). Treat null and undefined identically here so
    // those calls don't filter every tag out — see #515.
    if (args.parentId != null && built.parentId !== args.parentId) continue;
    if (args.status != null && built.status !== args.status) continue;

    result.push(built);
  }

  return JSON.stringify({ tags: result });
}
