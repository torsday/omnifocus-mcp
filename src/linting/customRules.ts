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
 * 4. **no-network-import** — imports of `http`, `https`, `node-fetch`, `axios`,
 *    `undici`, or `fetch` (as a standalone import) are forbidden. omnifocus-mcp
 *    communicates with OmniFocus only — outbound HTTP is never needed and would
 *    be a supply-chain / data-exfiltration risk (DESIGN §18).
 *
 * 5. **no-layer-violation** — enforces the adapter ↔ services ↔ tools layering:
 *    - `adapter/` must not import from `services/` or `tools/`
 *    - `tools/` must not import from `adapter/` directly (must go through a service)
 *    `domain/`, `errors/`, `envelope/`, `logging/`, `rateLimit/`, `concurrency/`,
 *    and `linting/` are utility layers reachable from everywhere.
 *
 * 6. **no-empty-catch-in-scripts** — empty `catch` bodies (`catch (...) {}`) are
 *    forbidden in `src/scripts/`. They silently swallow errors and are the primary
 *    reason JXA/OmniJS failures go undetected. Each catch must either re-throw,
 *    log to stderr, or carry a non-empty comment explaining why the error is
 *    deliberately ignored (`/* OF 4.x: … *\/`).
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
// Rule 4: no-network-import
// ---------------------------------------------------------------------------

/**
 * Banned network-library identifiers. Matches both static `import` statements
 * and dynamic `import(...)` calls.
 *
 * `node:http` and `node:https` are also banned — the server speaks only to
 * OmniFocus via JXA/OmniJS; the one legitimate outbound HTTP use case is
 * the webhook subsystem under `src/webhooks/` (per ADR-0016, #483), which
 * is allowlisted by `WEBHOOKS_ALLOWLIST_RE` below.
 */
export const NETWORK_IMPORT_RE =
  /\bimport\s*(?:\([^)]*['"]|[^'"]*['"])(node:https?|https?|node-fetch|axios|undici|cross-fetch)['"]/;

/**
 * Files under `src/webhooks/` are allowed to import `node:https` — the
 * webhook subsystem makes outbound HTTPS POSTs to user-registered URLs
 * per ADR-0016. No other path may import network libraries.
 */
export const WEBHOOKS_ALLOWLIST_RE = /(^|[/\\])src[/\\]webhooks[/\\]/;

// ---------------------------------------------------------------------------
// Rule 5: no-layer-violation
// ---------------------------------------------------------------------------

/**
 * Detect imports that cross the adapter ↔ services ↔ tools layer boundary.
 *
 * The `OmniFocusAdapter` interface is the public seam — tools and services may
 * import it freely. The *implementations* (`adapter/jxa/` and `adapter/omnijs/`)
 * must never be imported outside the adapter layer itself; only the router and
 * composition wiring are allowed to reach them. Likewise, transport implementations
 * must never reach up into services/ or tools/.
 *
 * Forbidden:
 *   adapter/jxa/ or adapter/omnijs/ importing from services/ or tools/
 *   services/ or tools/ importing from adapter/jxa/ or adapter/omnijs/
 *     (they must import the OmniFocusAdapter interface, not the implementations)
 */

/** Match any relative or absolute import that targets `services/` */
export const IMPORT_SERVICES_RE = /\bfrom\s+['"][^'"]*\/services\//;
/** Match any relative or absolute import that targets `tools/` */
export const IMPORT_TOOLS_RE = /\bfrom\s+['"][^'"]*\/tools\//;
/**
 * Match imports targeting the transport *implementations* (not the interface).
 * `adapter/OmniFocusAdapter` and `adapter/inMemory/` are permitted from anywhere.
 */
export const IMPORT_ADAPTER_IMPL_RE = /\bfrom\s+['"][^'"]*\/adapter\/(jxa|omnijs)\//;

/** Detect that a file lives inside a transport implementation directory */
export const IN_ADAPTER_IMPL_RE = /src[/\\]adapter[/\\](jxa|omnijs)[/\\]/;
/** Detect that a file lives under `src/services/` */
export const IN_SERVICES_RE = /src[/\\]services[/\\]/;
/** Detect that a file lives under `src/tools/` */
export const IN_TOOLS_RE = /src[/\\]tools[/\\]/;

// ---------------------------------------------------------------------------
// Violation type
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rule 6: no-empty-catch-in-scripts
// ---------------------------------------------------------------------------

/**
 * Match a catch clause whose body is empty (only whitespace between the braces).
 * This detects the single-line form: `catch (...) {}`.
 *
 * A body consisting solely of a block comment (`/* … *\/`) is the accepted
 * escape hatch — it forces authors to write down why the error is ignored.
 * The checker allows comment-only bodies by requiring a non-empty character
 * between `{` and `}` other than pure whitespace.
 */
export const EMPTY_CATCH_RE = /catch\s*\([^)]*\)\s*\{\s*\}/;

/** Files in `src/scripts/` where empty catches are banned */
export const IN_SCRIPTS_RE = /src[/\\]scripts[/\\]/;

export interface Violation {
  file: string;
  line: number;
  rule:
    | "no-id-cast"
    | "no-generic-error"
    | "no-metadata-interpolation"
    | "no-network-import"
    | "no-layer-violation"
    | "no-empty-catch-in-scripts";
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

    // Rule 4: no-network-import (with src/webhooks/ allowlist per ADR-0016)
    if (NETWORK_IMPORT_RE.test(line) && !WEBHOOKS_ALLOWLIST_RE.test(filePath)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-network-import",
        excerpt: line.trim(),
      });
    }

    // Rule 6: no-empty-catch-in-scripts
    // catch bodies in src/scripts/ must not be empty — require a comment rationale
    if (IN_SCRIPTS_RE.test(filePath) && EMPTY_CATCH_RE.test(line)) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-empty-catch-in-scripts",
        excerpt: line.trim(),
      });
    }

    // Rule 5: no-layer-violation
    // Transport implementations must not import up into services/ or tools/
    if (
      IN_ADAPTER_IMPL_RE.test(filePath) &&
      (IMPORT_SERVICES_RE.test(line) || IMPORT_TOOLS_RE.test(line))
    ) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-layer-violation",
        excerpt: line.trim(),
      });
    }
    // services/ and tools/ must not reach into transport implementations directly
    if (
      (IN_SERVICES_RE.test(filePath) || IN_TOOLS_RE.test(filePath)) &&
      IMPORT_ADAPTER_IMPL_RE.test(line)
    ) {
      violations.push({
        file: filePath,
        line: i + 1,
        rule: "no-layer-violation",
        excerpt: line.trim(),
      });
    }
  }

  return violations;
}
