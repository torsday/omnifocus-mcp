/**
 * `assertAttachmentPath` — path-scope guard for attachment operations.
 *
 * Resolves symlinks on `filePath` **before** checking the allowlist to
 * defeat symlink-escape attacks (DESIGN §18). Rejects any resolved path
 * that is not a strict prefix of at least one entry in `allowedPaths`.
 *
 * Hard-blocked prefixes (`/System`, `/private/System`, `/Library`,
 * `/private/Library`) are always rejected regardless of the allowlist —
 * writing attachments from system directories has no legitimate use case
 * and is most likely a path-traversal attempt.
 *
 * Default allowlist (when `OMNIFOCUS_ATTACHMENT_PATHS` is unset) is
 * `[homedir()]`, which restricts operations to files under the user's home
 * directory.
 *
 * @throws ValidationError — resolved path is outside every allowlist entry
 * @throws ValidationError — file does not exist or cannot be resolved
 */

import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { ValidationError } from "../errors/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Paths that are always blocked, regardless of the allowlist.
 * Normalised with a trailing separator so `/System` doesn't block `/SystemExtensions`.
 */
const ALWAYS_BLOCKED: readonly string[] = [
  "/System/",
  "/private/System/",
  "/Library/",
  "/private/Library/",
];

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Assert that `filePath` (after symlink resolution) is inside at least one
 * of the `allowedPaths`. Resolves without throwing when the path is in scope.
 *
 * @param filePath    - Absolute path to the file to check.
 * @param allowedPaths - Allowlist of directory prefixes. Entries are resolved
 *                       against the real filesystem; trailing separators are
 *                       normalised away.
 */
export async function assertAttachmentPath(
  filePath: string,
  allowedPaths: readonly string[],
): Promise<void> {
  // Resolve symlinks — this is the critical step that defeats traversal.
  let resolved: string;
  try {
    resolved = await realpath(filePath);
  } catch {
    throw new ValidationError(`Attachment file not found or cannot be resolved: ${filePath}`, {
      suggestion: "Verify the file path is correct and the file exists.",
      details: { field: "filePath", value: filePath },
    });
  }

  // Normalise: ensure path comparison is prefix-safe by appending sep.
  // e.g. /home/alice and /home/alicebob are different prefixes.
  const resolvedWithSep = resolved.endsWith(sep) ? resolved : resolved + sep;

  // Hard-blocked prefixes — always rejected.
  for (const blocked of ALWAYS_BLOCKED) {
    if (resolvedWithSep.startsWith(blocked)) {
      throw new ValidationError(
        `Attachment path resolves to a blocked system directory: ${resolved}`,
        {
          suggestion:
            "Attachment files must be under your home directory or an explicitly allowed path (OMNIFOCUS_ATTACHMENT_PATHS).",
          details: { field: "filePath", value: filePath, resolvedPath: resolved },
        },
      );
    }
  }

  // Allowlist check — must be under at least one allowed prefix.
  const allowed = allowedPaths.some((prefix) => {
    const prefixWithSep = prefix.endsWith(sep) ? prefix : prefix + sep;
    return resolvedWithSep.startsWith(prefixWithSep);
  });

  if (!allowed) {
    throw new ValidationError(`Attachment path is outside the allowed scope: ${resolved}`, {
      suggestion:
        "Move the file to your home directory, or add its parent directory to OMNIFOCUS_ATTACHMENT_PATHS (colon-separated list of absolute paths).",
      details: {
        field: "filePath",
        value: filePath,
        resolvedPath: resolved,
        allowedPaths: [...allowedPaths],
      },
    });
  }
}
