/**
 * `assertAttachmentSize` — pre-flight guard for attachment operations.
 *
 * Stats the file at `filePath` and throws `ValidationError` if its size
 * exceeds `maxMb` megabytes. Callers (e.g. `attachment_add`) should invoke
 * this before opening the file so over-sized payloads fail fast with an
 * actionable message.
 *
 * The default cap (`OMNIFOCUS_MAX_ATTACHMENT_MB`, default 100) is documented
 * in SPEC resolved-decisions and surfaced via `capabilities_get`. Passing
 * `maxMb = 0` disables the cap (treat as unlimited); negative values are
 * treated as 0.
 *
 * @throws ValidationError — file exceeds the size cap
 * @throws ValidationError — file does not exist or is not accessible
 */

import { stat } from "node:fs/promises";
import { ValidationError } from "../errors/index.js";

const BYTES_PER_MB = 1024 * 1024;

/**
 * Assert that the file at `filePath` does not exceed `maxMb` megabytes.
 * Resolves without throwing when the file is within bounds.
 *
 * @param filePath - Absolute path to the file to check.
 * @param maxMb    - Size cap in megabytes. `0` or negative = no cap.
 */
export async function assertAttachmentSize(filePath: string, maxMb: number): Promise<void> {
  // No cap — skip the stat entirely.
  if (maxMb <= 0) return;

  let fileStats: Awaited<ReturnType<typeof stat>>;
  try {
    fileStats = await stat(filePath);
  } catch {
    throw new ValidationError(`Attachment file not found or not accessible: ${filePath}`, {
      suggestion: "Verify the file path is correct and the file is readable.",
      details: { field: "filePath", value: filePath },
    });
  }

  const fileMb = fileStats.size / BYTES_PER_MB;
  if (fileMb > maxMb) {
    throw new ValidationError(
      `Attachment file exceeds the ${maxMb} MB size cap (file is ${fileMb.toFixed(2)} MB): ${filePath}`,
      {
        suggestion: `Reduce the file size to below ${maxMb} MB, or increase the cap via the OMNIFOCUS_MAX_ATTACHMENT_MB environment variable.`,
        details: {
          field: "filePath",
          value: filePath,
          fileSizeBytes: fileStats.size,
          capBytes: maxMb * BYTES_PER_MB,
        },
      },
    );
  }
}
