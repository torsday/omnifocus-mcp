/**
 * Prose helpers for *_describe preview tools.
 *
 * Name resolvers gracefully fall back to the raw ID when the adapter lookup
 * fails (e.g. stale ID, OmniFocus not running).
 */

import type { OmniFocusAdapter } from "../../adapter/OmniFocusAdapter.js";

/**
 * Format an ISO-8601 datetime string as a human-readable date.
 * Includes the time component only when the time is non-midnight UTC.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  if (hours === 0 && minutes === 0) {
    return `${year}-${month}-${day}`;
  }
  return `${year}-${month}-${day} ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function resolveProjectName(adapter: OmniFocusAdapter, id: string): Promise<string> {
  try {
    const project = await adapter.getProject(id as Parameters<typeof adapter.getProject>[0]);
    return project.name;
  } catch {
    return id;
  }
}

export async function resolveTaskName(adapter: OmniFocusAdapter, id: string): Promise<string> {
  try {
    const task = await adapter.getTask(id as Parameters<typeof adapter.getTask>[0]);
    return task.name;
  } catch {
    return id;
  }
}

export async function resolveTagName(adapter: OmniFocusAdapter, id: string): Promise<string> {
  try {
    const tag = await adapter.getTag(id as Parameters<typeof adapter.getTag>[0]);
    return tag.name;
  } catch {
    return id;
  }
}

export async function resolveFolderName(adapter: OmniFocusAdapter, id: string): Promise<string> {
  try {
    const folder = await adapter.getFolder(id as Parameters<typeof adapter.getFolder>[0]);
    return folder.name;
  } catch {
    return id;
  }
}
