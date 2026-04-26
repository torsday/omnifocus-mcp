/**
 * Zod schemas and TypeScript types for the Folder domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Dates are ISO-8601 with offset per ADR-0007; IDs are branded per ADR-0008.
 *
 * This M0 introduction is intentionally minimal — `Folder` CRUD ships in M2
 * (#54). The shape here exists so the adapter interface (#16) and the
 * InMemoryAdapter can be typed precisely from the start.
 *
 * @see docs/domain-reference.md — canonical field definitions
 */

import { z } from "zod";
import { type IsoDateString, isoDateString } from "./dates.js";
import { type FolderId, FolderId as FolderIdCtor } from "./ids.js";

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export interface Folder {
  id: FolderId;
  name: string;
  parentId: FolderId | null;
  projectCount: number;
  subfolderCount: number;
  createdAt: IsoDateString;
  modifiedAt: IsoDateString;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const FolderSchema: z.ZodType<Folder> = z.object({
  id: FolderIdCtor.schema,
  name: z.string(),
  parentId: FolderIdCtor.schema.nullable(),
  projectCount: z.number().int().min(0),
  subfolderCount: z.number().int().min(0),
  createdAt: isoDateString(),
  modifiedAt: isoDateString(),
}) as z.ZodType<Folder>;
