/**
 * HATEOAS-style `_links` navigation hints for Task and Project domain objects.
 *
 * Link blocks are constructed in the service layer from IDs already present on
 * the domain object. Adapters never set them; they remain optional on the
 * interfaces so existing adapter tests stay green.
 *
 * URI scheme: `omnifocus://<noun>/<id>`
 *
 * Opt-in (issue #792): `_links` is omitted from list/get tool responses
 * unless the caller passes `includeLinks: true`. The block re-encodes IDs
 * already present on the response (`id`, `projectId`, `parentId`, `tagIds`,
 * `folderId`), so LLM agents that act on IDs directly pay zero bytes for it
 * by default. HTTP clients that follow the links opt back in per-call.
 *
 * @see src/domain/task.ts — TaskLinks field
 * @see src/domain/project.ts — ProjectLinks field
 */

import { z } from "zod";
import type { FolderId, ProjectId, TagId, TaskId } from "./ids.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TaskLinks {
  self: string;
  /** URI to the owning project, or null if the task lives in the inbox. */
  project: string | null;
  /** URI to the parent task, or null if the task is top-level. */
  parent: string | null;
  /** URIs for each tag applied to the task. Empty array when no tags. */
  tags: string[];
}

export interface ProjectLinks {
  self: string;
  /** URI to the containing folder, or null if the project is root-level. */
  folder: string | null;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const taskLinksSchema: z.ZodType<TaskLinks> = z.object({
  self: z.string(),
  project: z.string().nullable(),
  parent: z.string().nullable(),
  tags: z.array(z.string()),
});

export const projectLinksSchema: z.ZodType<ProjectLinks> = z.object({
  self: z.string(),
  folder: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Builder functions
// ---------------------------------------------------------------------------

/**
 * Construct a `TaskLinks` block from the minimal ID set on a Task.
 *
 * Accepts plain string | null parameters so callers can pass branded ID types
 * directly (branded strings are assignable to `string`).
 */
export function buildTaskLinks(task: {
  id: TaskId;
  projectId: ProjectId | null;
  parentId: TaskId | null;
  tagIds: TagId[];
}): TaskLinks {
  return {
    self: `omnifocus://task/${task.id}`,
    project: task.projectId !== null ? `omnifocus://project/${task.projectId}` : null,
    parent: task.parentId !== null ? `omnifocus://task/${task.parentId}` : null,
    tags: task.tagIds.map((id) => `omnifocus://tag/${id}`),
  };
}

/**
 * Construct a `ProjectLinks` block from the minimal ID set on a Project.
 */
export function buildProjectLinks(project: {
  id: ProjectId;
  folderId: FolderId | null;
}): ProjectLinks {
  return {
    self: `omnifocus://project/${project.id}`,
    folder: project.folderId !== null ? `omnifocus://folder/${project.folderId}` : null,
  };
}
