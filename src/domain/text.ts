/**
 * Unicode-safe string helpers (#834).
 *
 * JavaScript's `String.prototype.length` and `.slice()` operate on UTF-16 code
 * *units*, not Unicode code *points*. Slicing at an arbitrary code-unit offset
 * can cut a surrogate pair in half — a 4-byte emoji (👨, 🦊, …) or any
 * astral-plane character (many CJK extensions) becomes a lone surrogate, which
 * serializes as the replacement character `�` or invalid UTF-8 on the wire.
 *
 * These helpers slice on code-point boundaries via `Array.from`, so a multibyte
 * character at the cut point is kept whole or dropped whole — never split.
 *
 * Scope note: code-point safety is the contract here, *not* grapheme-cluster
 * preservation. A ZWJ emoji sequence (e.g. 👨‍👩‍👧, a family glyph made of
 * several code points joined by U+200D) may still be cut between its component
 * code points at the boundary. Preventing that would require `Intl.Segmenter`
 * and a grapheme-aware budget; the wire-safety bug these helpers fix is the
 * surrogate split, which `Array.from` resolves. See `docs/design/i18n.md`.
 *
 * @see src/tools/task/notePreview.ts — the note-preview contract uses the same
 *   `Array.from` code-point slicing for its dedicated `notePreview` window.
 */

/** Ellipsis appended by {@link truncateWithEllipsis} (one code point, U+2026). */
export const ELLIPSIS = "…";

/**
 * Count the Unicode code points in `s` (not UTF-16 code units).
 *
 * `"🦊".length` is 2 (a surrogate pair); `codePointLength("🦊")` is 1.
 */
export function codePointLength(s: string): number {
  // Array.from iterates by code point, honouring surrogate pairs.
  return Array.from(s).length;
}

/**
 * Return the first `max` code points of `s`, never splitting a surrogate pair.
 * No ellipsis is appended — use this when the caller wants a raw prefix (e.g. a
 * fixed-width preview column). `max <= 0` returns the empty string.
 */
export function truncateCodePoints(s: string, max: number): string {
  if (max <= 0) return "";
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  return cps.slice(0, max).join("");
}

/**
 * Truncate `s` to at most `max` code points *including* a trailing ellipsis.
 * Strings already within budget are returned unchanged; longer strings are cut
 * to `max - 1` code points plus `…`, so the result is never longer than `max`
 * code points and never splits a surrogate pair.
 *
 * `max < 1` is treated as 1 (just the ellipsis) to keep the result non-empty
 * for any over-budget input.
 */
export function truncateWithEllipsis(s: string, max: number): string {
  const cps = Array.from(s);
  if (cps.length <= max) return s;
  const budget = Math.max(max - 1, 0);
  return cps.slice(0, budget).join("") + ELLIPSIS;
}
