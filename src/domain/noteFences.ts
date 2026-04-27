/**
 * Generic fenced metadata blocks inside OmniFocus task / project notes.
 *
 * Several features need to attach structured data to a free-form note without
 * stomping on what the user has typed there. The convention is a markdown
 * code fence with a tag name, holding `key: value` lines:
 *
 * ```waiting-on
 * whom: Alice
 * since: 2026-04-27T10:00:00-05:00
 * ```
 *
 * the rest of the user's note here…
 *
 * Properties of this format:
 *
 * - **Round-trippable.** Reading and writing the fence preserves the
 *   surrounding note exactly, including blank lines, trailing whitespace,
 *   and any *other* fences (e.g. a future `decision-journal` block).
 * - **Forgiving.** A malformed fence parses to "no data" rather than an
 *   error — the user might have hand-edited it. Tools that consume the
 *   parsed data should treat `undefined` as "feature not in use."
 * - **Visible.** Plain markdown is grepable in Apple Notes search and
 *   editable in OmniFocus's note editor when the user wants to tweak.
 *
 * The format is YAML-shaped but the parser is not a general YAML implementation
 * — it handles `key: value` lines (string values, optionally quoted) only.
 * This keeps the dependency surface small and the failure modes obvious.
 *
 * @see src/domain/waitingOn.ts — first consumer (#482)
 */

const FENCE_OPEN_PREFIX = "```";

/** Result of parsing one fence out of a note body. */
export interface FenceMatch {
  /** The raw inner block (no fences), as it appeared in the note. */
  body: string;
  /** Character index of the opening fence in the source string. */
  start: number;
  /** Character index just past the closing fence. */
  end: number;
}

/**
 * Locate the first fenced block tagged with `tag` inside `note`.
 *
 * Returns `undefined` when the note is null/empty or no fence is present.
 * The match is anchored at the start of a line; an inline backtick triple
 * mid-paragraph is ignored.
 */
export function findFence(note: string | null, tag: string): FenceMatch | undefined {
  if (note === null || note.length === 0) return undefined;
  const open = `${FENCE_OPEN_PREFIX}${tag}`;
  // Anchor on a line boundary: either start of string, or after a newline.
  const openRe = new RegExp(`(^|\\n)${escapeRegExp(open)}[ \\t]*\\n`);
  const m = openRe.exec(note);
  if (m === null) return undefined;
  const innerStart = m.index + m[0].length;
  // Match closing ``` at the start of a line.
  const closeRe = /\n```[ \t]*(?=\n|$)/;
  closeRe.lastIndex = innerStart;
  const tail = note.slice(innerStart);
  const c = closeRe.exec(tail);
  if (c === null) return undefined;
  const body = tail.slice(0, c.index);
  return {
    body,
    start: m.index + (m[1] === "" ? 0 : 1),
    end: innerStart + c.index + c[0].length,
  };
}

/**
 * Parse `key: value` lines out of a fence body.
 *
 * - Whitespace around the key and value is trimmed.
 * - Single- or double-quoted values are unquoted; quote escapes are not supported.
 * - Lines without a colon are skipped (treated as a malformed line, not an error).
 * - Blank lines are skipped.
 * - Duplicate keys: last write wins.
 *
 * Returns an empty object for an empty body.
 */
export function parseFenceBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key === "") continue;
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Serialize an object as `key: value` lines for use inside a fence.
 *
 * - Keys with `undefined` values are omitted.
 * - Values are written verbatim — no quoting is added. Callers should pass
 *   ISO date strings, simple identifiers, or human prose without leading/trailing
 *   whitespace. Newlines inside values are not supported.
 * - Output keys appear in the order they iterate from the input object.
 */
export function serializeFenceBody(fields: Record<string, string | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

/**
 * Replace (or insert) a fenced block in `note`.
 *
 * - When `note` already contains a fence with this `tag`, that block is replaced
 *   in place; the surrounding text is untouched.
 * - When `note` contains no such fence, the new block is prepended to the note,
 *   separated from any existing content by a blank line.
 * - When `note` is null or empty, the result is just the new fence.
 *
 * The fence body is the supplied `body` exactly — no trimming, no normalization.
 * Use `serializeFenceBody` to produce the body from a typed object.
 */
export function upsertFence(note: string | null, tag: string, body: string): string {
  const fenceText = `${FENCE_OPEN_PREFIX}${tag}\n${body}\n${FENCE_OPEN_PREFIX}`;
  const existing = findFence(note, tag);
  if (existing !== undefined && note !== null) {
    return note.slice(0, existing.start) + fenceText + note.slice(existing.end);
  }
  if (note === null || note.length === 0) return fenceText;
  return `${fenceText}\n\n${note}`;
}

/**
 * Remove a fenced block from `note`. Returns `null` when removal would leave
 * an empty string (clears the note entirely), otherwise the trimmed remainder.
 *
 * Surrounding blank lines around the removed fence are collapsed so the user
 * doesn't see an ugly gap where the metadata used to be.
 */
export function removeFence(note: string | null, tag: string): string | null {
  if (note === null) return null;
  const existing = findFence(note, tag);
  if (existing === undefined) return note.length === 0 ? null : note;
  const before = note.slice(0, existing.start).replace(/[ \t]*\n+$/, "");
  const after = note.slice(existing.end).replace(/^\n+[ \t]*/, "");
  let combined: string;
  if (before === "" || after === "") {
    combined = before + after;
  } else {
    combined = `${before}\n\n${after}`;
  }
  return combined === "" ? null : combined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
