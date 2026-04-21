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
 * @see DESIGN.md §6.7 — error taxonomy
 * @see DESIGN.md §18 — security posture
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
export const THROW_ALLOWED_RE = /src[/\\]errors[/\\]/;

/** Files excluded from custom rules (tests and the rule definitions themselves) */
export const EXCLUDED_FILES_RE =
  /\.(test|spec)\.(ts|js)$|src[/\\]linting[/\\]customRules\.(ts|js)$/;

// ---------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------

export interface Violation {
  file: string;
  line: number;
  rule: "no-id-cast" | "no-generic-error";
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
  }

  return violations;
}
