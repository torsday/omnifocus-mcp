/**
 * `omnifocus://calendar{?from,to}` MCP resource.
 *
 * Returns macOS calendar events (via the Swift `calendar-bridge` subprocess
 * per ADR-0018) in the half-open interval `[from, to)`. Both query params
 * are ISO-8601 strings; when omitted, defaults span the current local-zone
 * day (00:00 to 24:00).
 *
 * Read path:
 *
 *   omnifocus://calendar
 *     → today 00:00 → today 24:00 (local zone)
 *
 *   omnifocus://calendar?from=2026-04-29T00:00:00-05:00&to=2026-04-30T00:00:00-05:00
 *     → explicit range
 *
 * Caching: 60s TTL keyed on the `(from, to, sourcesEnv)` tuple. Calendar data
 * isn't write-heavy and EventKit reads are cheap, so a small TTL is enough
 * to dedupe the agenda resource's read amplification (slice 8) without
 * masking user changes for long.
 *
 * Errors propagate from the bridge:
 *   - `CalendarPermissionDenied`     — user has not granted Calendar access
 *   - `CalendarBridgeUnavailable`    — Swift binary missing or failed to start
 *
 * @see docs/adr/0018-calendar-bridge-eventkit-only.md
 * @see src/bridge/calendarBridge.ts — subprocess wrapper
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CalendarBridge, type CalendarEvent } from "../bridge/calendarBridge.js";

export const CALENDAR_URI_TEMPLATE = "omnifocus://calendar{?from,to}";

export interface CalendarResourcePayload {
  events: CalendarEvent[];
}

/** Default cache TTL — 60s per #484 AC. */
export const DEFAULT_CALENDAR_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * ISO-8601 timestamp for the start of today in the local zone (00:00:00.000),
 * encoded as a UTC string. The instant is the same regardless of formatter,
 * and the Swift bridge's `ISO8601DateFormatter` accepts `Z` suffixes.
 */
function localDayStartIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

function localDayEndIso(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).toISOString();
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: CalendarResourcePayload;
  expiresAt: number;
}

/**
 * Tiny single-key cache. The `from/to/sources` tuple is the cache key; any
 * change in any element invalidates the entry. We do NOT persist multiple
 * entries — the read pattern is "this hour, next hour, today, tomorrow",
 * each of which churns into a fresh fetch within the TTL anyway.
 */
class CalendarCache {
  private entry: { key: string; value: CacheEntry } | null = null;

  get(key: string, now: number): CalendarResourcePayload | null {
    if (!this.entry) return null;
    if (this.entry.key !== key) return null;
    if (this.entry.value.expiresAt <= now) return null;
    return this.entry.value.payload;
  }

  set(key: string, payload: CalendarResourcePayload, expiresAt: number): void {
    this.entry = { key, value: { payload, expiresAt } };
  }

  clear(): void {
    this.entry = null;
  }
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

export interface CalendarResourceDeps {
  bridge: Pick<CalendarBridge, "readEvents">;
  /** Override `Date.now()` and `new Date()` for tests. */
  now?: () => Date;
  /** Override the cache TTL. Default 60s. */
  ttlMs?: number;
  /** Calendar source filter env var. Default: `process.env.OMNIFOCUS_CALENDAR_SOURCES`. */
  sources?: string | undefined;
  /** Optional cache instance — defaults to a per-deps singleton. */
  cache?: CalendarCache;
}

/**
 * Build the calendar resource payload. Pure-ish: delegates to the bridge
 * (subprocess) for the actual EventKit read but otherwise has no side effects
 * beyond writing to the cache.
 */
export async function buildCalendarPayload(
  deps: CalendarResourceDeps,
  params: { from?: string | undefined; to?: string | undefined } = {},
): Promise<CalendarResourcePayload> {
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const ttlMs = deps.ttlMs ?? DEFAULT_CALENDAR_TTL_MS;
  const sources = deps.sources;

  const from = params.from ?? localDayStartIso(now);
  const to = params.to ?? localDayEndIso(now);

  const cache = deps.cache ?? defaultCache;
  const cacheKey = `${from}|${to}|${sources ?? ""}`;

  const cached = cache.get(cacheKey, now.getTime());
  if (cached) return cached;

  const events = await deps.bridge.readEvents(from, to, sources);
  const payload: CalendarResourcePayload = { events };
  cache.set(cacheKey, payload, now.getTime() + ttlMs);
  return payload;
}

// Default singleton cache used by the registered resource. Tests create their
// own CalendarCache to stay isolated from each other.
const defaultCache = new CalendarCache();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register `omnifocus://calendar{?from,to}` with an `McpServer`. Reads the
 * `OMNIFOCUS_CALENDAR_SOURCES` env var at call time (not at registration time)
 * so the operator can change it without restarting the server.
 */
export function registerCalendarResource(
  server: McpServer,
  bridge: Pick<CalendarBridge, "readEvents"> = new CalendarBridge(),
): void {
  server.registerResource(
    "omnifocus-calendar",
    new ResourceTemplate(CALENDAR_URI_TEMPLATE, { list: undefined }),
    {
      description:
        "macOS Calendar events from EventKit in the half-open interval [from, to). " +
        "Both query params are ISO-8601; when omitted, defaults span the current local-zone day. " +
        "Returns { events: CalendarEvent[] } where each event carries id, title, startsAt, endsAt, " +
        "allDay, calendarName, calendarSource, optional location, status (confirmed|tentative|cancelled), " +
        "and optional isAttendee. Read-only — does not write to EventKit. " +
        "Filter calendar sources via the OMNIFOCUS_CALENDAR_SOURCES env var (comma-separated, " +
        "substring match against calendar.title, case-insensitive). " +
        "Cached 60s. First call may trigger the macOS Calendar TCC prompt; subsequent calls return " +
        "the cached state. Throws CalendarPermissionDenied when access has not been granted.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const vars = variables as Record<string, string | undefined>;
      const payload = await buildCalendarPayload(
        { bridge, sources: process.env.OMNIFOCUS_CALENDAR_SOURCES },
        { from: vars.from, to: vars.to },
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

// Exported for tests that need to clear the singleton.
export { CalendarCache as _CalendarCache, defaultCache as _defaultCache };
