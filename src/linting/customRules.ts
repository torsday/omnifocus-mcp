/**
 * Custom lint rule logic for omnifocus-mcp.
 *
 * Enforces project-specific rules that Biome cannot express:
 *
 * 1. **no-id-cast** — `as TaskId` / `as ProjectId` / etc. forbidden outside
 *    `src/domain/ids.ts`. Branded IDs must flow through factory functions
 *    (ADR-0008); casts bypass the type system and allow aliasing bugs.
 *
 * 2. **no-generic-error** — `throw new Error(` forbidden outside
 *    `src/errors/`. All thrown errors must be typed OmniFocusError subclasses
 *    so agents receive stable error codes and actionable suggestions (DESIGN §6.7).
 *
 * 3. **no-metadata-interpolation** — OmniFocus user content (task names, notes,
 *    tag names) must never be interpolated into protocol metadata fields
 *    (`suggestion`, `message`, `warning` strings, `details` values beyond IDs).
 *    User content belongs only inside the typed `data` payload, never in the
 *    envelope metadata where an agent might treat it as a system instruction
 *    (DESIGN §18 — prompt injection containment).
 *
 *    Specifically, accessing `.name`, `.note`, `.noteHtml`, `.primaryTag.name`,
 *    or `.tags[*].name` of a domain object inside a metadata construction
 *    context (suggestion/message/warning literals) is forbidden.
 *
 * @see DESIGN.md §6.7 — error taxonomy
 * @see DESIGN.md §18 — security posture / prompt injection containment
 * @see docs/adr/0008-branded-id-types.md
 */

// ---------------------------------------------------------------------------
// Rule patterns
// ---------------------------------------------------------------------------

/** Branded ID type names that must not be used in `as` casts outside ids.ts */
export const BRANDED_ID_NAMES = ["TaskId", "ProjectId", "TagId", "FolderId", "AttachmentId"];

export const ID_CAST_RE = new RegExp(`\\bas\\s+(${BRANDED_ID_NAMES.join("|")})\\b`);

/** Files allowed to contain `as <ID>` casts */
export const ID_CAST_ALLOWED_RE = /src[/\\]domain[/\\]ids\.(ts|js)$/;

/** Match `throw new Error(` — exactly the base `Error` constructor */
export const THROW_NEW_ERROR_RE = /\bthrow\s+new\s+Error\s*\(/;

/** Files allowed to contain `throw new Error(` */
// JXA scripts (src/scripts/jxa/) and OmniJS scripts (src/scripts/omnijs/) run
// inside OmniFocus's embedded runtimes and cannot import typed errors —
// plain `throw new Error(...)` is the only option there.
export const THROW_ALLOWED_RE = /src[/\\]errors[/\\]|src[/\\]scripts[/\\](jxa|omnijs)[/\\]/;

/**
 * Match user-content property accesses that must not appear in metadata
 * construction contexts: `.name`, `.note`, `.noteHtml`, `.primaryTag.name`,
 * `.tags[...].name`, `.title` on domain objects.
 *
 * The pattern targets the interpolation sites, not the data payload itself.
 * It flags lines that combine a user-content accessor with a metadata keyword
 * (suggestion, message, warning, details, reason) in the same statement.
 *
 * Two complementary checks:
 *  a) String-interpolation of user content inside suggestion/message/warning strings:
 *     `suggestion: \`...\${task.name}...\`` or `message: "..." + task.name`
 *  b) Direct property assignment of user content to metadata keys:
 *     `suggestion: task.name` or `details: { reason: task.note }`
 *
 * False-positive safety: these patterns only match when both a user-content
 * accessor AND a metadata keyword appear on the same line.
 */
export const USER_CONTENT_ACCESSORS_RE =
  /\b(?:task|project|tag|folder|item)\.(name|note|noteHtml|title)\b/;

/** Metadata field names that must never receive user content */
export const METADATA_FIELD_RE = /\b(suggestion|warning|warnings|message)\s*[=:]/;

/** Files excluded from custom rules (tests and the rule definitions themselves) */
export const EXCLUDED_FILES_RE =
  /\.(test|spec)\.(ts|js)$|src[/\\]linting[/\\]customRules\.(ts|js)$/;

// ---------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------

export interface Violation {
  file: string;
  line: number;
  rule: "no-id-cast" | "no-generic-error" | "no-metadata-interpolation";
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Per-file checker (pure function — easy to test)
// ---------------------------------------------------------------------------

/**
 * Check `content` (the text of `filePath`) for rule violations.
 * Returns one `Violation` per matched line.
 */
export function checkFileContent(filePath: string, content: string): Violation[] {
  if (EXCLUDED_FILES_RE.test(filePath)) return [];

  const lines = content.split("\n");
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();

    // Skip comment lines — rules target runtime code, not documentation
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    if (!ID_CAST_ALLOWED_RE.test(filePath) && ID_CAST_RE.test(line)) {
      violations.push({ file: filePath, line: i + 1, rule: "no-id-cast", excerpt: line.trim() });
    }

    if (!THROW_ALLOWED_RE.test(filePath) && THROW_NEW_ERROR_RE.test(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-generic-error",
        excerpt: line.trim(),
      });
    }

    // Flag lines where a user-content accessor appears alongside a metadata field keyword.
    // Both patterns must match the same line to avoid false positives.
    if (USER_CONTENT_ACCESSORS_RE.test(line) && METADATA_FIELD_RE.test(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-metadata-interpolation",
        excerpt: line.trim(),
      });
    }
  }

  return violations;
}
