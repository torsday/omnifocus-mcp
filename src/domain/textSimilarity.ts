/**
 * Text similarity helpers — used by both the taxonomy-audit resource (tag
 * and project name collisions) and the `task_find_similar` tool (lexical
 * candidate ranking for de-duplication).
 *
 * Intentionally dependency-free — pure functions over strings with no
 * external library requirements.
 *
 * Two distinct surfaces share this module:
 *
 * - **Collision detection** (taxonomy-audit): `levenshtein`,
 *   `tokenSet`, `tokenSetEqual`, `collisionReason`. Optimized for
 *   "is X a near-duplicate of Y?" yes/no with a typed reason.
 *
 * - **Ranking** (task_find_similar, #469): `tokenize`, `jaccard`, `score`.
 *   Optimized for "rank N candidates against a reference by lexical
 *   signal" with a deterministic [0, 1] score.
 *
 * `normalizeName` is shared.
 *
 * @see src/resources/taxonomyAudit.ts — consumer (collision)
 * @see src/tools/task/findSimilar.ts — consumer (ranking)
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

// ---------------------------------------------------------------------------
// Ranking surface — used by `task_find_similar` (#469) for de-duplication.
//
// Different shape from the collision surface above: produces a deterministic
// [0, 1] score so a candidate set can be ranked, rather than a yes/no with a
// reason. Title-dominant on purpose — that's how a human triages duplicates
// ("Call dentist" vs "schedule dental cleaning"). Note overlap is a tiebreaker.
// ---------------------------------------------------------------------------

/** Tokens shorter than this are skipped for ranking — they're noise (a, of, to). */
const RANK_MIN_TOKEN_LENGTH = 2;

/**
 * Stop words excluded from the ranking token set. Small and English-biased on
 * purpose — the tool ships in English; if a future deployment is non-English,
 * the maintainer extends this list rather than the tool making locale-detection
 * decisions on its own.
 */
const RANK_STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/** Combine-weights — sum to 1.0 by construction so the score stays in [0, 1]. */
const TITLE_WEIGHT = 0.7;
const NOTE_WEIGHT = 0.2;
const PREFIX_BONUS = 0.05;
const EXACT_NAME_BOOST = 0.05;

/**
 * Tokenize a string into normalized words for ranking. Pure: lowercase →
 * split on non-word → filter to length ≥ `RANK_MIN_TOKEN_LENGTH` and not a
 * stop word.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .filter((t) => t.length >= RANK_MIN_TOKEN_LENGTH && !RANK_STOP_WORDS.has(t));
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0 when both sets are empty
 * (no signal in either direction).
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Inputs to the combined scorer. */
export interface ScoreInput {
  name: string;
  note?: string | null;
}

/**
 * Compute the similarity score for one candidate against a reference.
 *
 * Components (all in [0, 1] before weighting):
 *   - title  = Jaccard(tokens(reference.name), tokens(candidate.name))
 *   - note   = Jaccard(tokens(reference.note), tokens(candidate.note))
 *             — only contributes when both sides have a non-empty note
 *   - prefix = 1 if both titles share the first non-stop-word token, else 0
 *   - exact  = 1 if the normalized titles match, else 0
 *
 * Final score = title·0.7 + note·0.2 + prefix·0.05 + exact·0.05, clamped to
 * [0, 1]. Title-dominance is intentional (see file docstring).
 */
export function score(reference: ScoreInput, candidate: ScoreInput): number {
  const refTitleTokens = new Set(tokenize(reference.name));
  const candTitleTokens = new Set(tokenize(candidate.name));
  const titleScore = jaccard(refTitleTokens, candTitleTokens);

  let noteScore = 0;
  if (reference.note && candidate.note) {
    const refNoteTokens = new Set(tokenize(reference.note));
    const candNoteTokens = new Set(tokenize(candidate.note));
    if (refNoteTokens.size > 0 && candNoteTokens.size > 0) {
      noteScore = jaccard(refNoteTokens, candNoteTokens);
    }
  }

  const refLeading = [...refTitleTokens][0];
  const candLeading = [...candTitleTokens][0];
  const prefixScore = refLeading !== undefined && refLeading === candLeading ? 1 : 0;

  const exactScore = normalizeName(reference.name) === normalizeName(candidate.name) ? 1 : 0;

  const combined =
    titleScore * TITLE_WEIGHT +
    noteScore * NOTE_WEIGHT +
    prefixScore * PREFIX_BONUS +
    exactScore * EXACT_NAME_BOOST;

  // Belt-and-suspenders clamp — combined weights sum to 1.0 by construction
  // but a future tweak could nudge it; the runtime check protects callers.
  return Math.max(0, Math.min(1, combined));
}
