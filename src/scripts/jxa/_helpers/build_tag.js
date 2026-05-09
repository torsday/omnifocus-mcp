/**
 * Canonical buildTag helper for JXA scripts.
 *
 * Inlined into consumer scripts via the `// @inline _helpers/build_tag.js`
 * directive expanded by scriptInlinerPlugin (ADR-0020). This file is not
 * loaded as a module at runtime — it is spliced as raw source into each
 * consumer's bundled string before `osascript` evaluates it.
 *
 * Shape and guards merge the prior 5 copies (tag_create, tag_get,
 * tag_get_many, tag_list, tag_update) preserving every issue-referenced
 * fix verbatim:
 *
 *   - #673 (parent.class flavor) — `p.class()` throws "Can't convert types"
 *     on a real Tag/Project specifier in OF 4.x; only the document responds.
 *     Treat the throw as "real tag", a successful return of `"document"` as
 *     the only skip path. Wrap the inner `p.id()` call in its own try too,
 *     since pathological tag specifiers can throw on `.id()` independently.
 *   - #498 — `creationDate()`, `modificationDate()`, `allowsNextAction()`,
 *     and `tasks().length` may be truthy as functions yet throw "Can't get
 *     object." on invocation. Truthiness on the property reference is not
 *     enough; the call must be guarded. tag_list adopted this fully; the
 *     other four copies still used the property-truthy fallback for
 *     allowsNextAction and tasks count, leaving the same silent-failure mode
 *     #498 was meant to close. The canonical helper closes it uniformly.
 *
 * @param {object} tag — JXA Tag specifier
 * @returns {object} canonical Tag shape per `src/domain/tag.ts`
 */
// biome-ignore lint/correctness/noUnusedVariables: inlined into JXA consumers via @inline directive (ADR-0020).
function buildTag(tag, docId) {
  // OF 4.x: tag.parent() and tag.containingTag() both throw "Can't convert
  // types." on real Tag specifiers — neither is usable. tag.container() works
  // and returns either the parent tag or the document. Distinguish by
  // comparing container.id() to the document's id (passed in as docId because
  // resolving it per-call would round-trip through osascript on every tag).
  let parentId = null;
  try {
    const c = tag.container();
    if (c) {
      try {
        const cid = c.id();
        if (cid !== docId) parentId = cid;
      } catch (_idErr) {
        /* OF 4.x: pathological container specifier — leave parentId = null */
      }
    }
  } catch (_e) {
    /* OF 4.x: container() may also throw on certain specifier shapes */
  }

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
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  let rawStatus = "active";
  try {
    rawStatus = tag.status();
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }
  const status = rawStatus === "on hold" ? "on-hold" : rawStatus;

  let allowsNextAction = false;
  try {
    allowsNextAction = tag.allowsNextAction();
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  let taskCount = 0;
  try {
    taskCount = tag.tasks().length;
  } catch (_e) {
    /* OF 4.x: property access may not exist on all object types — default used */
  }

  // Guard against "Can't get object." thrown when invoking these — see #498.
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
