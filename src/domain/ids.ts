/**
 * Branded opaque ID types for OmniFocus resources.
 *
 * OmniFocus assigns each object (task, project, tag, folder, attachment) a
 * persistent alphanumeric identifier that survives renames, moves, and
 * completions. Names, by contrast, are not unique, are editable, and drift —
 * they cannot be identifiers. Per ADR-0008, every API reference uses an ID,
 * never a name.
 *
 * Inside the codebase these IDs are branded so the type system prevents a
 * `TagId` from being accidentally passed where a `TaskId` is expected. At the
 * MCP wire boundary they flatten to plain strings; the branding is a TS-only
 * guarantee with zero runtime cost.
 *
 * The conservative runtime shape check (`^[A-Za-z0-9._-]{3,64}$`) is
 * deliberately lenient — OmniFocus persistent IDs in the wild are typically
 * ~11 alphanumeric characters (e.g. `gHqVKr3xAWo`), but we also accept
 * underscores, hyphens, and dots and a wider length band to tolerate future
 * changes without a breaking update. The dot is required because OmniFocus
 * surfaces repeating-task instance IDs as `<parentId>.<integer>` (e.g.
 * `kyenmzWH4Mh.44`); see #497. A stricter check belongs in the adapter
 * layer if OF ever commits to a specific format.
 *
 * @see DESIGN.md §13 — ID strategy
 * @see docs/adr/0008-ids-branded-opaque-strings.md — decision record
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded types
// ---------------------------------------------------------------------------

// Brand keys are string literals (not `unique symbol`) per ADR-0008. Symbol
// brands cause TS4023 "cannot be named" errors in declaration emit when a
// schema typed by the brand crosses module boundaries (the symbol type is
// not nameable from consuming `.d.ts` files); string-literal brands sidestep
// that entirely while preserving cross-kind type-safety.
export type TaskId = string & { readonly __brand: "TaskId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type TagId = string & { readonly __brand: "TagId" };
export type FolderId = string & { readonly __brand: "FolderId" };
export type AttachmentId = string & { readonly __brand: "AttachmentId" };

// ---------------------------------------------------------------------------
// Runtime validation
// ---------------------------------------------------------------------------

/**
 * Conservative shape OmniFocus persistent IDs must match: 3–64 characters of
 * alphanumerics, underscores, hyphens, or dots. Tolerant enough to survive
 * OF's internal evolution; strict enough to reject obvious non-IDs.
 *
 * The dot is required for OmniFocus repeating-task instance IDs, which take
 * the form `<parentId>.<integer>` (e.g. `kyenmzWH4Mh.44`). Excluding `.`
 * caused every read tool that round-trips IDs through `TaskIdCtor.of()` to
 * fail when a project contained ≥1 repeating task — see #497.
 */
export const OMNIFOCUS_ID_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

/** True if the input looks like an OmniFocus ID. Kind-agnostic. */
export function isOmniFocusId(value: unknown): value is string {
  return typeof value === "string" && OMNIFOCUS_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

function makeIdConstructor<Branded extends string, K extends string>(kind: K) {
  const schema = z
    .string()
    .regex(OMNIFOCUS_ID_PATTERN, `Invalid ${kind}: expected 3-64 alphanumeric / _ / - characters`)
    .transform((s): Branded => s as Branded);

  return {
    /** Brand tag for debuggability — `"TaskId"`, `"ProjectId"`, etc. */
    kind,
    /** Validate and narrow a string to the branded type. Throws `ZodError` on invalid input. */
    of(raw: string): Branded {
      return schema.parse(raw);
    },
    /** Narrowing guard — true if the value is a string with valid OF-ID shape. */
    is(value: unknown): value is Branded {
      return isOmniFocusId(value);
    },
    /** Zod schema that parses a plain string into the branded type. */
    schema,
  } as const;
}

export const TaskId = makeIdConstructor<TaskId, "TaskId">("TaskId");
export const ProjectId = makeIdConstructor<ProjectId, "ProjectId">("ProjectId");
export const TagId = makeIdConstructor<TagId, "TagId">("TagId");
export const FolderId = makeIdConstructor<FolderId, "FolderId">("FolderId");
export const AttachmentId = makeIdConstructor<AttachmentId, "AttachmentId">("AttachmentId");

/** All five constructors keyed by kind — for generic adapter / test code. */
export const IdConstructors = {
  TaskId,
  ProjectId,
  TagId,
  FolderId,
  AttachmentId,
} as const;

export type IdKind = keyof typeof IdConstructors;
