// lookupOrThrow — force a JXA byId(...) lookup and throw a structured
// "<kindLabel> not found: <idValue>" error if the id doesn't exist.
// JXA byId is lazy and always truthy; the lookup fires on the next method
// call as "(-1728)". Calling .id() here forces resolution while kindLabel
// and idValue are in scope. See #687, #674, ADR-0020.
// Inlined into consumers via `// @inline _helpers/lookup_or_throw.js`.
// biome-ignore lint/correctness/noUnusedVariables: inlined via @inline directive (ADR-0020).
function lookupOrThrow(specifier, kindLabel, idValue) {
  try {
    specifier.id();
  } catch (_e) {
    throw new Error(`${kindLabel} not found: ${idValue}`);
  }
  return specifier;
}
