/**
 * Zod schemas and TypeScript types for the Project domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Dates are ISO-8601 with offset per ADR-0007; IDs are branded per ADR-0008.
 *
 * The explicit interface (Project) is the source of truth for the TypeScript
 * type; the zod schema is annotated as `z.ZodType<Project>` to avoid TS4023
 * "cannot be named" errors caused by unique-symbol brands inside deeply-
 * inferred zod generics.
 *
 * @see docs/domain-reference.md — canonical field definitions
 * @see DESIGN.md §13 — ID strategy
 * @see DESIGN.md §14 — date handling
 */

import { z } from "zod";
import { type IsoDateString, isoDateString } from "./dates.js";
import {
  type FolderId,
  FolderId as FolderIdCtor,
  type ProjectId,
  ProjectId as ProjectIdCtor,
  type TagId,
  TagId as TagIdCtor,
} from "./ids.js";
// biome-ignore lint/correctness/noUnusedImports: used in interface and schema
import { type ProjectLinks, projectLinksSchema } from "./links.js";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: ProjectId;
  name: string;
  note: string | null;
  noteHtml: string | null;

  folderId: FolderId | null;
  tagIds: TagId[];

  status: "active" | "on-hold" | "done" | "dropped";
  completionCriterion: "parallel" | "sequential" | "singleActions";

  deferDate: IsoDateString | null;
  dueDate: IsoDateString | null;
  estimatedMinutes: number | null;
  flagged: boolean;

  reviewIntervalDays: number | null;
  nextReviewDate: IsoDateString | null;
  lastReviewDate: IsoDateString | null;

  completed: boolean;
  completedAt: IsoDateString | null;
  dropped: boolean;
  droppedAt: IsoDateString | null;

  taskCount: number;
  completedTaskCount: number;

  createdAt: IsoDateString;
  modifiedAt: IsoDateString;

  _links?: ProjectLinks;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const ProjectSchema: z.ZodType<Project, z.ZodTypeDef, unknown> = z.object({
  id: ProjectIdCtor.schema,
  name: z.string(),
  note: z.string().nullable(),
  noteHtml: z.string().nullable(),

  folderId: FolderIdCtor.schema.nullable(),
  tagIds: z.array(TagIdCtor.schema),

  status: z.enum(["active", "on-hold", "done", "dropped"]),
  completionCriterion: z.enum(["parallel", "sequential", "singleActions"]),

  deferDate: isoDateString().nullable(),
  dueDate: isoDateString().nullable(),
  estimatedMinutes: z.number().int().min(1).nullable(),
  flagged: z.boolean(),

  reviewIntervalDays: z.number().int().min(1).nullable(),
  nextReviewDate: isoDateString().nullable(),
  lastReviewDate: isoDateString().nullable(),

  completed: z.boolean(),
  completedAt: isoDateString().nullable(),
  dropped: z.boolean(),
  droppedAt: isoDateString().nullable(),

  taskCount: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),

  createdAt: isoDateString(),
  modifiedAt: isoDateString(),

  _links: projectLinksSchema.optional(),
}) as z.ZodType<Project, z.ZodTypeDef, unknown>;
