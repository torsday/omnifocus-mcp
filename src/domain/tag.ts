/**
 * Zod schemas and TypeScript types for the Tag domain object.
 *
 * Matches the canonical schema in `docs/domain-reference.md` exactly.
 * Dates are ISO-8601 with offset per ADR-0007; IDs are branded per ADR-0008.
 *
 * This M0 introduction is intentionally minimal — `Tag` CRUD ships in M2 (#49,
 * #50). The shape here exists so the adapter interface (#16) and InMemoryAdapter
 * can be typed precisely from the start.
 *
 * @see docs/domain-reference.md — canonical field definitions
 */

import { z } from "zod";
import { type IsoDateString, isoDateString } from "./dates.js";
import { type TagId, TagId as TagIdCtor } from "./ids.js";

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export interface TagLocation {
  name: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  trigger: "entering" | "leaving" | "both";
}

export interface Tag {
  id: TagId;
  name: string;
  parentId: TagId | null;

  status: "active" | "on-hold" | "dropped";

  location: TagLocation | null;
  allowsNextAction: boolean;

  taskCount: number;

  createdAt: IsoDateString;
  modifiedAt: IsoDateString;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const TagLocationSchema: z.ZodType<TagLocation> = z.object({
  name: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().min(0),
  trigger: z.enum(["entering", "leaving", "both"]),
}) as z.ZodType<TagLocation>;

/**
 * Top-level field names of a {@link Tag} record. Used by the `fields[]`
 * projection (#773). `id` is omitted — always retained by the projection.
 */
export const TAG_FIELD_NAMES = [
  "name",
  "parentId",
  "status",
  "location",
  "allowsNextAction",
  "taskCount",
  "createdAt",
  "modifiedAt",
] as const;

/** Fast-lookup Set form of {@link TAG_FIELD_NAMES}. */
export const TAG_FIELD_NAMES_SET: ReadonlySet<string> = new Set(TAG_FIELD_NAMES);

/** @public — canonical Tag validator, retained for adapter/CRUD use. */
export const TagSchema: z.ZodType<Tag> = z.object({
  id: TagIdCtor.schema,
  name: z.string(),
  parentId: TagIdCtor.schema.nullable(),

  status: z.enum(["active", "on-hold", "dropped"]),

  location: TagLocationSchema.nullable(),
  allowsNextAction: z.boolean(),

  taskCount: z.number().int().min(0),

  createdAt: isoDateString(),
  modifiedAt: isoDateString(),
}) as z.ZodType<Tag>;
