/**
 * Field-level record diffing for sync deltas (#819).
 *
 * `changes_since` returns `{ id, changes: Partial<T> }` for each modified
 * entity instead of the whole record — a 5–10× payload cut for sync-style
 * consumers. This module computes that `changes` map by comparing a prior
 * snapshot of an entity against its current state, returning only the fields
 * whose values actually changed.
 *
 * Domain records (Task / Project) are plain JSON-serializable data — scalars,
 * arrays (e.g. `tagIds`), and nested objects (e.g. `repetition`) — so a
 * recursive structural comparison is both correct and dependency-free.
 *
 * @see src/tools/sync/changesSince.ts — consumer
 * @see docs/adr/0026-sync-delta-protocol.md
 */

/** Structural deep-equality for plain JSON-shaped values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const ax = a as unknown[];
    const bx = b as unknown[];
    if (ax.length !== bx.length) return false;
    return ax.every((v, i) => deepEqual(v, bx[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * Return only the fields of `current` whose values differ from `prior`.
 *
 * A field present in `prior` but absent in `current` is reported with value
 * `undefined` (it was cleared). Keys whose values are deep-equal are omitted —
 * so an empty result means "no observable change".
 */
export function diffRecord<T>(prior: T, current: T): Partial<T> {
  const changes: Partial<T> = {};
  const p = prior as Record<string, unknown>;
  const c = current as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(p), ...Object.keys(c)]);
  for (const key of keys) {
    if (!deepEqual(p[key], c[key])) {
      (changes as Record<string, unknown>)[key] = c[key];
    }
  }
  return changes;
}
