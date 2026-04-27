/**
 * Task-predicate evaluator for `task_reclassify`.
 *
 * A discriminated-union AST that lets agents express compound match rules
 * ("title contains 'invoice' AND not in @finance") in structured JSON,
 * then evaluate the rule against each task in TypeScript. We don't push
 * the predicate down into JXA's `whose()` because JXA has no logical OR
 * and limited NOT — at the cost of an extra full task list pass we get
 * exact, predictable semantics.
 *
 * @see #471 — initial implementation
 * @see src/tools/task/reclassify.ts — tool wiring
 */

import type { ProjectId, TagId } from "./ids.js";
import type { Task } from "./task.js";

// ---------------------------------------------------------------------------
// Predicate AST — discriminated union, recursive
// ---------------------------------------------------------------------------

export type TaskPredicate =
  | { kind: "title-contains"; value: string; caseSensitive?: boolean | undefined }
  | { kind: "tag"; tagId: TagId }
  | { kind: "project"; projectId: ProjectId }
  | { kind: "and"; predicates: TaskPredicate[] }
  | { kind: "or"; predicates: TaskPredicate[] }
  | { kind: "not"; predicate: TaskPredicate };

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Determine whether a task matches the predicate.
 *
 * Pure: no side effects, no I/O. Recurses through `and` / `or` / `not`
 * compositions. Empty `and` returns `true` (vacuously); empty `or` returns
 * `false` (vacuously) — matches standard logic.
 *
 * `title-contains` is case-insensitive by default; pass
 * `caseSensitive: true` to opt out.
 */
export function evaluatePredicate(predicate: TaskPredicate, task: Task): boolean {
  switch (predicate.kind) {
    case "title-contains": {
      const haystack = predicate.caseSensitive ? task.name : task.name.toLowerCase();
      const needle = predicate.caseSensitive ? predicate.value : predicate.value.toLowerCase();
      return haystack.includes(needle);
    }
    case "tag":
      return task.tagIds.some((id) => String(id) === String(predicate.tagId));
    case "project":
      return task.projectId !== null && String(task.projectId) === String(predicate.projectId);
    case "and":
      return predicate.predicates.every((p) => evaluatePredicate(p, task));
    case "or":
      return predicate.predicates.some((p) => evaluatePredicate(p, task));
    case "not":
      return !evaluatePredicate(predicate.predicate, task);
  }
}
