/**
 * `omnifocus://agenda{?date}` MCP resource — the user-facing payoff of #484.
 *
 * Merges that day's macOS calendar events (via the Swift `calendar-bridge`
 * subprocess per ADR-0018) with the OmniFocus forecast for the same day, then
 * returns a single timeline:
 *
 *   {
 *     items: AgendaItem[],     // timed entries, sorted by startsAt ASC
 *     floating: AgendaItem[],  // OF tasks with no time-of-day
 *   }
 *
 * Each `AgendaItem` is a discriminated union on `kind`:
 *
 *   { kind: "calendar-event", id, title, startsAt, endsAt, allDay,
 *     calendarName, calendarSource, location?, status, isAttendee? }
 *   { kind: "of-task", id, name, startsAt, dueDate, deferDate,
 *     flagged, projectId, parentId }
 *
 * "Timed" OF task = a forecast task whose `dueDate` is non-null. The dueDate
 * IS its time-of-day on the agenda. Tasks without a `dueDate` (overdue with
 * no due, deferred-today, flagged-only, etc.) appear under `floating` and
 * are sorted by name.
 *
 * Default `date` is today's local-zone day. Cached 60s — same TTL as the
 * calendar resource since the agenda is read-amplified by it.
 *
 * @see docs/adr/0018-calendar-bridge-eventkit-only.md
 * @see src/resources/calendar.ts — calendar half of the merge
 * @see src/services/forecastService.ts — OF half of the merge
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CalendarBridge, type CalendarEvent } from "../bridge/calendarBridge.js";
import type { ProjectId, TaskId } from "../domain/ids.js";
import type { Task } from "../domain/task.js";
import { ValidationError } from "../errors/index.js";
import type { ForecastService } from "../services/forecastService.js";

export const AGENDA_URI_TEMPLATE = "omnifocus://agenda{?date}";
export const DEFAULT_AGENDA_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

export type AgendaItem =
  | ({ kind: "calendar-event" } & CalendarEvent)
  | {
      kind: "of-task";
      id: TaskId;
      name: string;
      startsAt: string;
      dueDate: string | null;
      deferDate: string | null;
      flagged: boolean;
      projectId: ProjectId | null;
      parentId: TaskId | null;
    };

export interface AgendaResourcePayload {
  items: AgendaItem[];
  floating: AgendaItem[];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Local-zone start of the day containing `now`, encoded UTC ISO. */
function localDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/** Parse a date string. Accepts ISO-8601 (with or without offset) and bare YYYY-MM-DD. */
function parseDate(raw: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`agenda: could not parse date as ISO-8601: ${raw}`, {
      details: { raw },
    });
  }
  // Bare dates parse as UTC midnight under ECMAScript rules — the *previous*
  // local day anywhere west of UTC. Re-construct as local midnight so
  // ?date=YYYY-MM-DD means the user's calendar day (cf. ADR-0007 and the
  // bare-date precedent in src/taskParser/transportText.ts).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parts = raw.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
  }
  return d;
}

// ---------------------------------------------------------------------------
// Floating-vs-timed split for forecast tasks
// ---------------------------------------------------------------------------

/**
 * Whether an OF task should appear on the timed agenda. The dueDate IS the
 * agenda time — if it's null, the task is floating. We do NOT down-rank
 * midnight-due tasks here: the forecast view already places them at 00:00,
 * and OF users who set explicit midnight dues mean it.
 */
function isTimed(task: Task): boolean {
  return task.dueDate !== null;
}

function ofTaskItem(task: Task, startsAt: string): AgendaItem {
  return {
    kind: "of-task",
    id: task.id,
    name: task.name,
    startsAt,
    dueDate: task.dueDate,
    deferDate: task.deferDate,
    flagged: task.flagged,
    projectId: task.projectId,
    parentId: task.parentId,
  };
}

// ---------------------------------------------------------------------------
// Cache (single-key — same shape as calendar.ts)
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: AgendaResourcePayload;
  expiresAt: number;
}

class AgendaCache {
  private entry: { key: string; value: CacheEntry } | null = null;

  get(key: string, now: number): AgendaResourcePayload | null {
    if (!this.entry || this.entry.key !== key || this.entry.value.expiresAt <= now) {
      return null;
    }
    return this.entry.value.payload;
  }

  set(key: string, payload: AgendaResourcePayload, expiresAt: number): void {
    this.entry = { key, value: { payload, expiresAt } };
  }
}

const defaultCache = new AgendaCache();

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

export interface AgendaResourceDeps {
  bridge: Pick<CalendarBridge, "readEvents">;
  forecastService: Pick<ForecastService, "get">;
  /** Override `new Date()` for tests. */
  now?: () => Date;
  /** Override the cache TTL. Default 60s. */
  ttlMs?: number;
  /** Calendar source filter env var. Default: `process.env.OMNIFOCUS_CALENDAR_SOURCES`. */
  sources?: string | undefined;
  /** Optional cache instance — defaults to a per-deps singleton. */
  cache?: AgendaCache;
}

/**
 * Build the merged agenda payload for `date` (defaults to today's local-zone
 * day). The merge is deterministic: calendar events first by `startsAt` ASC,
 * OF timed tasks interleaved by their `dueDate`, ties broken by name.
 * Floating OF tasks (no dueDate) sort by name.
 */
export async function buildAgendaPayload(
  deps: AgendaResourceDeps,
  params: { date?: string | undefined } = {},
): Promise<AgendaResourcePayload> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const ttlMs = deps.ttlMs ?? DEFAULT_AGENDA_TTL_MS;
  const sources = deps.sources;

  const day = params.date ? localDayStart(parseDate(params.date)) : localDayStart(now);
  // Next local midnight via calendar math — a fixed +24h would land at 23:00
  // on the 25-hour DST fall-back day and 01:00 next-day on spring-forward.
  const dayEnd = new Date(day);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const fromIso = day.toISOString();
  const toIso = dayEnd.toISOString();

  const cache = deps.cache ?? defaultCache;
  const cacheKey = `${fromIso}|${toIso}|${sources ?? ""}`;

  const cached = cache.get(cacheKey, now.getTime());
  if (cached) return cached;

  const [events, forecast] = await Promise.all([
    deps.bridge.readEvents(fromIso, toIso, sources),
    deps.forecastService.get({ from: fromIso, to: toIso }),
  ]);

  // De-duplicate the forecast across categories — a task can appear in both
  // `dueToday` and `flagged`, for example. Use task id as the key.
  const seenTaskIds = new Set<string>();
  const tasks: Task[] = [];
  for (const t of [
    ...forecast.dueToday,
    ...forecast.deferredToday,
    ...forecast.flagged,
    ...forecast.overdue,
  ]) {
    const k = String(t.id);
    if (seenTaskIds.has(k)) continue;
    seenTaskIds.add(k);
    tasks.push(t);
  }

  const calendarItems: AgendaItem[] = events.map((e) => ({ kind: "calendar-event", ...e }));
  const timedTasks = tasks.filter(isTimed);
  const floatingTasks = tasks.filter((t) => !isTimed(t));

  const timedTaskItems: AgendaItem[] = timedTasks.map((t) =>
    // biome-ignore lint/style/noNonNullAssertion: isTimed guarantees dueDate is non-null
    ofTaskItem(t, t.dueDate!),
  );

  const items: AgendaItem[] = [...calendarItems, ...timedTaskItems].sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    return itemName(a).localeCompare(itemName(b));
  });

  const floating: AgendaItem[] = floatingTasks
    .map((t) => ofTaskItem(t, ""))
    .sort((a, b) => itemName(a).localeCompare(itemName(b)));

  const payload: AgendaResourcePayload = { items, floating };
  cache.set(cacheKey, payload, now.getTime() + ttlMs);
  return payload;
}

function itemName(item: AgendaItem): string {
  return item.kind === "calendar-event" ? item.title : item.name;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAgendaResource(
  server: McpServer,
  forecastService: ForecastService,
  bridge: Pick<CalendarBridge, "readEvents"> = new CalendarBridge(),
): void {
  server.registerResource(
    "omnifocus-agenda",
    new ResourceTemplate(AGENDA_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "Merged daily agenda: macOS calendar events from EventKit interleaved with the OmniFocus " +
        "forecast for the same day. Returns { items, floating } where items[] is the sorted " +
        "timeline (calendar-event and of-task entries by startsAt ASC) and floating[] is OF tasks " +
        "with no dueDate. Each AgendaItem is tagged kind: 'calendar-event' | 'of-task'. " +
        "date query param is ISO-8601; defaults to today (local zone). Cached 60s. " +
        "Throws CalendarPermissionDenied when Calendar access has not been granted; " +
        "throws CalendarBridgeUnavailable when the Swift binary is missing.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const payload = await buildAgendaPayload(
        { bridge, forecastService, sources: process.env.OMNIFOCUS_CALENDAR_SOURCES },
        { date: vars.date },
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  );
}

// Exported for tests.
export { AgendaCache as _AgendaCache };
