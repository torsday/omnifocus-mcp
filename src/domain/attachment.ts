/**
 * Zod schemas and TypeScript types for the Attachment domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Dates are ISO-8601 with offset per ADR-0007; IDs are branded per ADR-0008.
 * Attachment **content** is never returned over MCP — use `attachment_save_to_path`.
 *
 * @see docs/domain-reference.md § Attachment
 */

import { z } from "zod";
import { type AttachmentId, AttachmentId as AttachmentIdCtor } from "./ids.js";

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------

export interface Attachment {
  id: AttachmentId;
  /** Filename as shown in OmniFocus. */
  name: string;
  mimeType: string | null;
  /** null when the file is an alias pointing to a missing file. */
  sizeBytes: number | null;
  /** ISO-8601 with offset. */
  addedAt: string;
  kind: "embedded" | "alias";
}

// Branded ID types carry a phantom `__brand` property that plain `z.string()`
// can't satisfy directly. We use `transform` to apply the brand at parse time
// so the schema correctly produces `AttachmentId` values at runtime.
/** @public — canonical Attachment validator, retained for adapter/CRUD use. */
export const attachmentSchema: z.ZodType<Attachment> = z.object({
  id: z.string().transform((s) => AttachmentIdCtor.of(s)),
  name: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  addedAt: z.string(),
  kind: z.enum(["embedded", "alias"]),
}) as unknown as z.ZodType<Attachment>;
