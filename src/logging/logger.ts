/**
 * Singleton structured logger for omnifocus-mcp.
 *
 * Writes compact JSON lines to stderr. Never touches stdout — MCP uses stdio
 * transport and any stray stdout byte corrupts the protocol.
 *
 * PII fields (task name, note, noteHtml, tagNames, attachment names/paths)
 * are redacted at every level — pino applies the redactor before writing
 * regardless of `level`, so the `info` / `debug` distinction is purely a
 * visibility threshold for *whether* the event emits, not for *whether*
 * the field is censored. See `docs/security.md` § "PII redaction model"
 * for the full taxonomy and `tests/logging/redactionCanary.test.ts`-style
 * canary in `logger.test.ts` for the regression bar.
 *
 * Log level is controlled by `OMNIFOCUS_LOG_LEVEL` (default `info`).
 *
 * @see DESIGN.md §21 — observability contract
 * @see docs/security.md — PII redaction model
 */

import pino from "pino";

// ---------------------------------------------------------------------------
// PII redaction paths — applied at every level (#842 audit + extension)
// ---------------------------------------------------------------------------

/**
 * Pino redaction paths covering every shape that can carry user-content
 * PII when an event payload includes domain objects.
 *
 * Path semantics (per fast-redact):
 * - `name` matches the top-level `name` key
 * - `*.name` matches one level deep (e.g. `meta.name`, `data.name`)
 * - `arr[*].name` matches every element of `arr`'s `name`
 * - There is **no** `**` deep wildcard — every nested-array shape we ship
 *   is enumerated below. New shapes that surface in `data.*` need an
 *   explicit entry; the canary test in `logger.test.ts` will fail loud
 *   if a new array path introduces an unredacted leak.
 *
 * Coverage classes:
 * 1. **Direct** — top-level + one-level wildcard for ad-hoc payloads
 * 2. **Per-domain arrays** — `tasks[*]`, `projects[*]`, `tags[*]`,
 *    `folders[*]`, `attachments[*]` under both top-level and `data.*`
 * 3. **Forecast buckets** — `data.overdue[*]`, `data.dueToday[*]`,
 *    `data.deferredToday[*]`, `data.flagged[*]`, `data.inbox[*]`
 * 4. **Single-object wrappers** — `data.task.name`, `data.project.name`, etc.
 * 5. **Attachment-specific** — name + path (filename can leak intent)
 *
 * Anything explicitly NOT redacted (IDs, dates, booleans, status enums)
 * is documented in `docs/security.md` with rationale.
 */
const PII_REDACT_PATHS = [
  // 1. Direct
  "name",
  "note",
  "noteHtml",
  "tagNames",
  "tagNames[*]",
  "*.name",
  "*.note",
  "*.noteHtml",
  "*.tagNames",
  "data.name",
  "data.note",
  "data.noteHtml",
  "data.tagNames",
  "data.tagNames[*]",

  // 2. Per-domain arrays (top-level — when tools return raw collections)
  "tasks[*].name",
  "tasks[*].note",
  "tasks[*].noteHtml",
  "tasks[*].tagNames",
  "tasks[*].tagNames[*]",
  "projects[*].name",
  "projects[*].note",
  "projects[*].noteHtml",
  "tags[*].name",
  "folders[*].name",
  "attachments[*].name",
  "attachments[*].path",

  // 2'. Per-domain arrays under `data.*` — the envelope path
  "data.tasks[*].name",
  "data.tasks[*].note",
  "data.tasks[*].noteHtml",
  "data.tasks[*].tagNames",
  "data.tasks[*].tagNames[*]",
  "data.projects[*].name",
  "data.projects[*].note",
  "data.projects[*].noteHtml",
  "data.tags[*].name",
  "data.folders[*].name",
  "data.attachments[*].name",
  "data.attachments[*].path",

  // 3. Forecast buckets — same shape as tasks[*]
  "data.overdue[*].name",
  "data.overdue[*].note",
  "data.overdue[*].noteHtml",
  "data.overdue[*].tagNames",
  "data.overdue[*].tagNames[*]",
  "data.dueToday[*].name",
  "data.dueToday[*].note",
  "data.dueToday[*].noteHtml",
  "data.dueToday[*].tagNames",
  "data.dueToday[*].tagNames[*]",
  "data.deferredToday[*].name",
  "data.deferredToday[*].note",
  "data.deferredToday[*].noteHtml",
  "data.deferredToday[*].tagNames",
  "data.deferredToday[*].tagNames[*]",
  "data.flagged[*].name",
  "data.flagged[*].note",
  "data.flagged[*].noteHtml",
  "data.flagged[*].tagNames",
  "data.flagged[*].tagNames[*]",
  "data.inbox[*].name",
  "data.inbox[*].note",
  "data.inbox[*].noteHtml",
  "data.inbox[*].tagNames",

  // 4. Single-object wrappers (`{ task: ... }`, `{ project: ... }`, etc.)
  "data.task.name",
  "data.task.note",
  "data.task.noteHtml",
  "data.task.tagNames",
  "data.task.tagNames[*]",
  "data.project.name",
  "data.project.note",
  "data.project.noteHtml",
  "data.tag.name",
  "data.folder.name",
  "data.attachment.name",
  "data.attachment.path",

  // 5. Common error / details surfaces
  // Error envelopes carry user input verbatim under `details.input` for
  // diagnostics — redact the input shapes most likely to be PII.
  "details.input.name",
  "details.input.note",
  "details.input.noteHtml",
  "details.input.tagNames",
  "details.input.destPath",
  "err.details.input.name",
  "err.details.input.note",
  "err.details.input.noteHtml",
  "err.details.input.destPath",
];

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

/**
 * Create a pino logger bound to stderr with PII redaction.
 * Separated from the singleton so tests can create isolated instances.
 */
export function createLogger(level = "info"): pino.Logger {
  return pino(
    {
      level,
      redact: {
        paths: PII_REDACT_PATHS,
        censor: "[redacted]",
      },
      // Compact output — no pretty-print, one JSON line per event
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.epochTime,
    },
    process.stderr,
  );
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Module-level singleton logger. Level is read from the environment at import
 * time. Call `setLogLevel` to override after config is parsed.
 */
export const logger: pino.Logger = createLogger(process.env.OMNIFOCUS_LOG_LEVEL ?? "info");

/**
 * Update the singleton's runtime log level. Called once config is validated.
 */
export function setLogLevel(level: string): void {
  logger.level = level;
}

/**
 * Exported for tests that need to assert the redaction surface (canary
 * tests, future audit passes). Production callers should never read this
 * directly — it's internal to `createLogger`.
 */
export const REDACTION_PATHS_FOR_TESTS: readonly string[] = PII_REDACT_PATHS;
