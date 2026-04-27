/**
 * `omnifocus://waiting-on` MCP resource.
 *
 * Aggregates every task that has a `waiting-on` fenced block in its note
 * (#482). Returns one row per task with the parsed fields plus a derived
 * `daysOverdue` integer keyed off `followUpAfter`. Sorted by daysOverdue
 * descending — the most-overdue follow-ups surface first; entries with no
 * follow-up date land at the end.
 *
 * Read-only and safe to call as often as the cache TTL allows; the underlying
 * scan is `adapter.listTasks({ completed: false })` followed by an
 * in-process note-parse — no separate index, no metadata cache.
 *
 * @see DESIGN.md §28 — MCP resources
 * @see src/domain/waitingOn.ts — fence parser
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { daysOverdue, parseWaitingOn } from "../domain/waitingOn.js";

export const WAITING_ON_URI = "omnifocus://waiting-on";

export interface WaitingOnResourceItem {
  taskId: string;
  name: string;
  whom: string;
  what?: string;
  since: string;
  followUpAfter?: string;
  daysOverdue: number | null;
}

export interface WaitingOnResourcePayload {
  items: WaitingOnResourceItem[];
}

/** Pure builder — exported so tests can drive it without the MCP wrapper. */
export async function buildWaitingOnPayload(
  adapter: OmniFocusAdapter,
  now: Date = new Date(),
): Promise<WaitingOnResourcePayload> {
  const tasks = await adapter.listTasks({ completed: false });
  const items: WaitingOnResourceItem[] = [];
  for (const task of tasks) {
    const entry = parseWaitingOn(task.note);
    if (entry === undefined) continue;
    items.push({
      taskId: String(task.id),
      name: task.name,
      whom: entry.whom,
      ...(entry.what !== undefined && { what: entry.what }),
      since: entry.since,
      ...(entry.followUpAfter !== undefined && { followUpAfter: entry.followUpAfter }),
      daysOverdue: daysOverdue(entry, now),
    });
  }

  // Sort: most-overdue (largest daysOverdue) first; null daysOverdue (no
  // follow-up date or follow-up still in the future) sinks to the end. Ties
  // break on `since` ascending (oldest wait first).
  items.sort((a, b) => {
    const ad = a.daysOverdue;
    const bd = b.daysOverdue;
    if (ad === null && bd === null) {
      return a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
    }
    if (ad === null) return 1;
    if (bd === null) return -1;
    if (ad !== bd) return bd - ad;
    return a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
  });

  return { items };
}

export function registerWaitingOnResource(server: McpServer, adapter: OmniFocusAdapter): void {
  server.registerResource(
    "omnifocus-waiting-on",
    WAITING_ON_URI,
    {
      description:
        "All tasks with structured waiting-on metadata, sorted by daysOverdue descending. " +
        "Each item: { taskId, name, whom, what?, since, followUpAfter?, daysOverdue }. " +
        "daysOverdue is the integer number of whole days past followUpAfter (0 same-day, " +
        "null when followUpAfter is unset or still in the future). " +
        "Use to surface stalled follow-ups without scanning every task. " +
        "Read-only; safe to retry. Set waiting-on with task_set_waiting_on; clear with task_clear_waiting_on.",
      mimeType: "application/json",
    },
    async (_uri) => {
      const payload = await buildWaitingOnPayload(adapter);
      return {
        contents: [
          {
            uri: WAITING_ON_URI,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}
