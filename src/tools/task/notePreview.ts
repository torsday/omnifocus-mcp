/**
 * Note-preview contract for task read responses (#775).
 *
 * OmniFocus task notes can be multi-KB markdown bodies. Bulk reads return
 * the full note for every task by default — a real workflow cost when
 * notes are long but the LLM only needs the metadata. This module
 * implements the truncation contract: short notes pass through untouched
 * (backwards compatible), long notes are replaced with a `notePreview` +
 * `noteTruncated: true` + `noteLength` triplet so the LLM knows the
 * preview is partial and can fetch the full text via `note_get` when
 * needed.
 *
 * Truncation is at a Unicode codepoint boundary, never a UTF-16 code unit
 * — so a 4-byte emoji at the boundary won't be split into half a
 * surrogate pair.
 *
 * @see DESIGN.md §26 — read tool pattern
 * @see src/tools/note/get.ts — `note_get` is the full-text fetcher
 */

/** Default character cap for the note-preview window. */
export const DEFAULT_NOTE_PREVIEW_CHARS = 200;

/** Sentinel value: pass `-1` (or any negative number) to opt out of truncation. */
export const NO_TRUNCATION = -1;

/**
 * Fields added to a Task's wire shape when its note exceeds the preview cap.
 * Mutually exclusive with the `note` field — when truncation applies, `note`
 * is removed and these three appear instead.
 */
export interface NotePreviewFields {
  notePreview: string;
  noteTruncated: true;
  noteLength: number;
}

const utf8Encoder = new TextEncoder();

/**
 * Apply the note-preview contract to a Task-shaped object.
 *
 * Accepts both full Task records (where `note` is always defined) and
 * field-projected partials where `note` may be absent entirely (#773).
 * When `note` is missing or null the input passes through.
 *
 * - `notePreviewChars < 0`: opt-out, returns the input unchanged.
 * - `task.note` absent / null / ≤ `notePreviewChars` codepoints: returns
 *   the input unchanged (the common short-note case is wire-compatible
 *   with pre-#775 callers).
 * - Otherwise: returns a new object with `note` removed and `notePreview`,
 *   `noteTruncated`, `noteLength` added. `noteLength` is the UTF-8 byte
 *   length of the original note — what an HTTP `Content-Length` would
 *   report — so the LLM can decide whether fetching the full text is
 *   worth the cost.
 */
export function applyNotePreview<T extends { note?: string | null }>(
  task: T,
  notePreviewChars: number,
): T | (Omit<T, "note"> & NotePreviewFields) {
  if (notePreviewChars < 0) return task;
  if (task.note === undefined || task.note === null) return task;

  const codepoints = Array.from(task.note);
  if (codepoints.length <= notePreviewChars) return task;

  const { note, ...rest } = task;
  return {
    ...rest,
    notePreview: codepoints.slice(0, notePreviewChars).join(""),
    noteTruncated: true,
    noteLength: utf8Encoder.encode(note).length,
  };
}
