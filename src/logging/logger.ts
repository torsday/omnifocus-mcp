/**
 * Singleton structured logger for omnifocus-mcp.
 *
 * Writes compact JSON lines to stderr. Never touches stdout — MCP uses stdio
 * transport and any stray stdout byte corrupts the protocol.
 *
 * PII fields (task name, note, noteHtml, tagNames) are redacted at `info` and
 * above. They are visible only at `debug` or below — see DESIGN §21.
 *
 * Log level is controlled by `OMNIFOCUS_LOG_LEVEL` (default `info`).
 *
 * @see DESIGN.md §21 — observability contract
 */

import pino from "pino";

// ---------------------------------------------------------------------------
// PII redaction paths — applied at info+ per DESIGN §21
// ---------------------------------------------------------------------------

/**
 * Pino redaction paths covering all PII fields defined in DESIGN §21.
 * Covers both top-level and nested occurrences (e.g. inside `data` objects).
 */
const PII_REDACT_PATHS = [
  "name",
  "note",
  "noteHtml",
  "tagNames",
  "tagNames[*]",
  "data.name",
  "data.note",
  "data.noteHtml",
  "data.tagNames",
  "data.tagNames[*]",
  "*.name",
  "*.note",
  "*.noteHtml",
  "*.tagNames",
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
