/**
 * Text similarity helpers for taxonomy-audit collision detection.
 *
 * Used by `omnifocus://taxonomy-audit` to identify tag and project names
 * that are likely duplicates or near-duplicates of each other.
 *
 * Intentionally dependency-free — pure functions over strings with no
 * external library requirements.
 *
 * @see src/resources/taxonomyAudit.ts — consumer
 * @see DESIGN.md §28 — MCP resources spec
 */

// ---------------------------------------------------------------------------
// Levenshtein distance
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the iterative two-row algorithm (O(n) space). Returns the minimum
 * number of single-character edits (insert, delete, substitute) needed to
 * transform `a` into `b`.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Keep two rows: previous and current
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      // biome-ignore lint/style/noNonNullAssertion: indices are within bounds
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }

  // biome-ignore lint/style/noNonNullAssertion: b.length is a valid index
  return prev[b.length]!;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a name for comparison: lower-case, trim, collapse internal
 * whitespace, strip leading `@` (OmniFocus tag convention).
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ").replace(/^@/, "");
}

/**
 * Convert a name to a sorted token set (words split on whitespace / `-` / `_`).
 * `"Pay invoices"` and `"invoices pay"` produce the same token set.
 */
export function tokenSet(name: string): string[] {
  return normalizeName(name)
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .sort();
}

/** Return true if two names have identical token sets (order-insensitive). */
export function tokenSetEqual(a: string, b: string): boolean {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.length !== tb.length) return false;
  return ta.every((t, i) => t === tb[i]);
}

// ---------------------------------------------------------------------------
// Collision reason
// ---------------------------------------------------------------------------

/**
 * Collision reasons in order of specificity (most specific first).
 *
 * - `exact-duplicate` — normalised strings are identical (same name, same case)
 * - `case-difference` — lower-cased strings are identical (e.g. "Work" vs "work")
 * - `plural-singular` — one name is the other with a trailing "s" appended/removed
 * - `near-duplicate`  — Levenshtein ≤ 2 OR token-set equality
 */
export type CollisionReason =
  | "exact-duplicate"
  | "case-difference"
  | "plural-singular"
  | "near-duplicate";

/**
 * Determine whether two names collide and, if so, why.
 *
 * Returns the most-specific reason, or `null` if no collision is detected.
 * Both names must be distinct (caller's responsibility — don't compare a name
 * to itself).
 */
export function collisionReason(a: string, b: string): CollisionReason | null {
  if (a === b) return "exact-duplicate";

  const na = normalizeName(a);
  const nb = normalizeName(b);

  if (na === nb) return "case-difference";

  // plural-singular: one is the other plus/minus a trailing "s" (or "es")
  if (na === `${nb}s` || nb === `${na}s` || na === `${nb}es` || nb === `${na}es`) {
    return "plural-singular";
  }

  // near-duplicate: Levenshtein ≤ 2 or token-set equality
  if (levenshtein(na, nb) <= 2 || tokenSetEqual(a, b)) {
    return "near-duplicate";
  }

  return null;
}
