/**
 * Deterministic JSON serialization with object keys sorted at every depth.
 *
 * `JSON.stringify` does not produce identical output for structurally-
 * identical inputs that differ only in key order, and the native
 * `JSON.stringify(value, replacerArray)` form is *not* a fix: passing a
 * replacer array filters properties to that fixed key list at *every*
 * depth, so nested keys not present at the top level get dropped — which
 * collapses distinct calls into the same hash.
 *
 * This helper recurses through arrays and objects, sorting keys at each
 * level. The output is suitable for hashing (loop-detector dedup keys,
 * transport-call argsHash, pagination cursor filterHash) but is *not*
 * guaranteed to be valid JSON — `undefined` at the top level is encoded as
 * the literal string `"undefined"` so `null` and `undefined` produce
 * distinct hashes. Within objects, `undefined`-valued keys are skipped to
 * match `JSON.stringify`'s behavior; this is what callers expect when they
 * pass a partial filter object.
 *
 * Originally extracted from three near-identical copies in:
 *   - src/loopDetector/LoopDetector.ts (`buildCallKey`)
 *   - src/logging/transportCall.ts     (`hashArgs`)
 *   - src/pagination/cursor.ts         (`hashFilter` — the bug fixed in #760)
 *
 * The pagination copy used to sort only top-level keys, so two semantically-
 * identical filters that differed in nested-key order produced different
 * hashes — tripping `ValidationError("Cursor filter hash does not match…")`
 * on page 2. Centralizing the implementation makes that class of bug
 * un-instantiable for future callers.
 */

/** Recursively serialize a value with object keys sorted at every depth. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(",")}}`;
}
