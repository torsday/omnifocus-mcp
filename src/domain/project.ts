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
  /** When true, defer time follows the user across time zones. Omitted when false. */
  deferDateFloating?: boolean;
  dueDate: IsoDateString | null;
  /** When true, due time follows the user across time zones. Omitted when false. */
  dueDateFloating?: boolean;
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

/**
 * Top-level field names of a {@link Project} record. Used by the `fields[]`
 * projection (#773). `id` is omitted — always retained by the projection.
 */
export const PROJECT_FIELD_NAMES = [
  "name",
  "note",
  "noteHtml",
  "folderId",
  "tagIds",
  "status",
  "completionCriterion",
  "deferDate",
  "deferDateFloating",
  "dueDate",
  "dueDateFloating",
  "estimatedMinutes",
  "flagged",
  "reviewIntervalDays",
  "nextReviewDate",
  "lastReviewDate",
  "completed",
  "completedAt",
  "dropped",
  "droppedAt",
  "taskCount",
  "completedTaskCount",
  "createdAt",
  "modifiedAt",
  "_links",
] as const;

/** Fast-lookup Set form of {@link PROJECT_FIELD_NAMES}. */
export const PROJECT_FIELD_NAMES_SET: ReadonlySet<string> = new Set(PROJECT_FIELD_NAMES);

export const ProjectSchema: z.ZodType<Project> = z.object({
  id: ProjectIdCtor.schema,
  name: z.string(),
  note: z.string().nullable(),
  noteHtml: z.string().nullable(),

  folderId: FolderIdCtor.schema.nullable(),
  tagIds: z.array(TagIdCtor.schema),

  status: z.enum(["active", "on-hold", "done", "dropped"]),
  completionCriterion: z.enum(["parallel", "sequential", "singleActions"]),

  deferDate: isoDateString().nullable(),
  deferDateFloating: z.boolean().optional(),
  dueDate: isoDateString().nullable(),
  dueDateFloating: z.boolean().optional(),
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
}) as z.ZodType<Project>;
