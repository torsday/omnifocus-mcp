/**
 * OPML serialisation helpers for `ExportService.exportOpml`.
 *
 * OPML (Outline Processor Markup Language) is an XML dialect for hierarchical
 * outlines. We emit OmniFocus's own OPML conventions so the result round-trips
 * back into OmniFocus via File → Import.
 *
 * These helpers are adapter-agnostic pure functions — they accept already-
 * fetched domain objects and produce strings. The service layer orchestrates
 * which tasks/projects to fetch.
 *
 * @see src/services/exportService.ts — orchestrator that calls these helpers
 * @see DESIGN.md §6.5 — service layer principles
 */

import type { Project } from "../../domain/project.js";
import type { Task } from "../../domain/task.js";

/** Escape XML special characters in attribute values. */
export function xmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Build an `<outline>` element for a task, recursively rendering children.
 *
 * Attributes follow OmniFocus's own OPML conventions:
 * - `text` — task name (required by OPML spec)
 * - `type` — `"omnifocus:task"` to allow round-trip import
 * - `id` — persistent OmniFocus ID
 * - `due` — ISO-8601 due date, omitted if null
 * - `defer` — ISO-8601 defer date, omitted if null
 * - `flagged` — `"true"` if flagged, omitted if false
 * - `completed` — `"true"` if completed, omitted if false
 * - `dropped` — `"true"` if dropped, omitted if false
 * - `note` — plain-text note, omitted if null/empty
 */
export function renderTaskOutline(
  task: Task,
  childrenByParent: Map<string, Task[]>,
  indent: string,
): string {
  const attrs: string[] = [
    `text="${xmlAttr(task.name)}"`,
    `type="omnifocus:task"`,
    `id="${xmlAttr(String(task.id))}"`,
  ];
  if (task.dueDate) attrs.push(`due="${xmlAttr(task.dueDate)}"`);
  if (task.deferDate) attrs.push(`defer="${xmlAttr(task.deferDate)}"`);
  if (task.flagged) attrs.push(`flagged="true"`);
  if (task.completed) attrs.push(`completed="true"`);
  if (task.dropped) attrs.push(`dropped="true"`);
  if (task.note) attrs.push(`note="${xmlAttr(task.note)}"`);

  const children = childrenByParent.get(String(task.id)) ?? [];
  if (children.length === 0) {
    return `${indent}<outline ${attrs.join(" ")} />`;
  }

  const childIndent = `${indent}  `;
  const childLines = children
    .map((c) => renderTaskOutline(c, childrenByParent, childIndent))
    .join("\n");
  return `${indent}<outline ${attrs.join(" ")}>\n${childLines}\n${indent}</outline>`;
}

/**
 * Build an `<outline>` element for a project with its task tree.
 */
export function renderProjectOutline(project: Project, tasks: Task[], indent: string): string {
  // Build parent → children map for tasks in this project
  const byParent = new Map<string, Task[]>();
  const rootTasks: Task[] = [];

  for (const task of tasks) {
    if (task.parentId === null) {
      rootTasks.push(task);
    } else {
      const key = String(task.parentId);
      const existing = byParent.get(key);
      if (existing) {
        existing.push(task);
      } else {
        byParent.set(key, [task]);
      }
    }
  }

  const attrs: string[] = [
    `text="${xmlAttr(project.name)}"`,
    `type="omnifocus:project"`,
    `id="${xmlAttr(String(project.id))}"`,
    `status="${xmlAttr(project.status)}"`,
  ];
  if (project.dueDate) attrs.push(`due="${xmlAttr(project.dueDate)}"`);
  if (project.deferDate) attrs.push(`defer="${xmlAttr(project.deferDate)}"`);
  if (project.flagged) attrs.push(`flagged="true"`);
  if (project.note) attrs.push(`note="${xmlAttr(project.note)}"`);

  const childIndent = `${indent}  `;
  if (rootTasks.length === 0) {
    return `${indent}<outline ${attrs.join(" ")} />`;
  }

  const childLines = rootTasks.map((t) => renderTaskOutline(t, byParent, childIndent)).join("\n");
  return `${indent}<outline ${attrs.join(" ")}>\n${childLines}\n${indent}</outline>`;
}
