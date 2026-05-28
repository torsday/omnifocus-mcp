/**
 * Canonical length limits for user-supplied string inputs.
 *
 * Apply these constants via Zod `.max()` on all user-facing tool schemas.
 * Rejection surfaces as a structured ValidationError with
 * `remediationClass: "client_error"` (Zod schema validation).
 *
 * @see #825 — security audit for length caps
 */

/** Maximum characters for any OmniFocus item name (task, project, folder, tag). */
export const NAME_MAX_CHARS = 1_024; // "max 1 KB"

/** Maximum characters for a plain-text note body (note_set, note_append, create, update). */
export const NOTE_MAX_CHARS = 1_048_576; // "max 1 MB"

/** Maximum characters for an HTML note body (note_set_html). */
export const NOTE_HTML_MAX_CHARS = 1_048_576; // "max 1 MB"

/** Maximum characters for a search query string (search_query). */
export const SEARCH_QUERY_MAX_CHARS = 4_096; // "max 4 KB"

/** Maximum characters for a file path (attachment_add, attachment_save_to_path). */
export const FILE_PATH_MAX_CHARS = 4_096; // PATH_MAX on macOS

/** Maximum characters for a substring search pattern (task_reclassify). */
export const SUBSTRING_MAX_CHARS = 4_096; // "max 4 KB"
