/**
 * Per-domain default-value registry for read-response field elision (#774).
 *
 * Each entry documents which fields the wire shape elides when present at
 * their default value. The "default" is the value that the LLM should infer
 * when the field is *absent* from a read response.
 *
 * Convention (also documented in {@link elideDefaults}):
 *
 * - **Boolean flags** at `false` are the common case for triage workloads
 *   (most tasks are unflagged, uncompleted, undropped). Eliding them is the
 *   biggest win on bulk reads.
 * - **Empty arrays** elide via the spec's `value: []` matcher.
 * - **Null reference fields** (`note: null`, `dueDate: null`, etc.) elide;
 *   absent === null === default-applies for these.
 * - **Required IDs** (`id`, `name`) and structural counts (`taskCount`) are
 *   never elided — they're informative even when small.
 * - **`projectId: null`** is *not* elided on tasks: the distinction between
 *   "in inbox" (null) and "in some project" matters and absence would be
 *   ambiguous against a generic missing-field reading.
 * - **Status enums** (`status: "active"`, `completionCriterion: "parallel"`)
 *   elide when at the most common value — keeps the wire lean while letting
 *   `on-hold` / `done` / `dropped` stand out.
 *
 * @see #774 — implementation
 * @see #770 — token-efficiency epic
 */

import type { Folder } from "../domain/folder.js";
import type { Project } from "../domain/project.js";
import type { Tag } from "../domain/tag.js";
import type { Task } from "../domain/task.js";
import type { FieldDefaults } from "./elideDefaults.js";

/**
 * Defaults applied to {@link Task} on read responses. The omitted-→-default
 * convention is documented in `docs/domain-reference.md` and
 * `docs/token-cost.md`.
 */
export const TASK_DEFAULTS: FieldDefaults<Task> = {
  flagged: { value: false },
  completed: { value: false },
  completedAt: { value: null },
  dropped: { value: false },
  droppedAt: { value: null },
  available: { value: true },
  blocked: { value: false },
  sequential: { value: false },
  completedByChildren: { value: false },
  note: { value: null, equivalentTo: [""] },
  noteHtml: { value: null, equivalentTo: [""] },
  parentId: { value: null },
  tagIds: { value: [] },
  deferDate: { value: null },
  dueDate: { value: null },
  estimatedMinutes: { value: null },
  repetition: { value: null },
  // projectId is intentionally not elided — null vs missing carries meaning
  // (inbox vs unknown), and a non-null value is a high-information field.
};

/** Defaults applied to {@link Project} on read responses. */
export const PROJECT_DEFAULTS: FieldDefaults<Project> = {
  flagged: { value: false },
  completed: { value: false },
  completedAt: { value: null },
  dropped: { value: false },
  droppedAt: { value: null },
  note: { value: null, equivalentTo: [""] },
  noteHtml: { value: null, equivalentTo: [""] },
  folderId: { value: null },
  tagIds: { value: [] },
  status: { value: "active" },
  completionCriterion: { value: "parallel" },
  deferDate: { value: null },
  dueDate: { value: null },
  estimatedMinutes: { value: null },
  reviewIntervalDays: { value: null },
  nextReviewDate: { value: null },
  lastReviewDate: { value: null },
};

/** Defaults applied to {@link Tag} on read responses. */
export const TAG_DEFAULTS: FieldDefaults<Tag> = {
  parentId: { value: null },
  status: { value: "active" },
  location: { value: null },
  allowsNextAction: { value: true },
};

/** Defaults applied to {@link Folder} on read responses. */
export const FOLDER_DEFAULTS: FieldDefaults<Folder> = {
  parentId: { value: null },
  // projectCount / subfolderCount stay even at zero — the LLM uses them to
  // gauge folder health and "0" is itself signal.
};
