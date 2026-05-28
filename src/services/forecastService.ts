/**
 * `ForecastService` — forecast-view query service.
 *
 * Returns tasks grouped by forecast category (overdue, due today, deferred
 * today, flagged) for a caller-supplied date range. This is the "what's on
 * my plate today" primitive (SPEC §forecast). Cached at 30s (ADR-0006) since
 * it's the most frequently read view.
 *
 * @see DESIGN.md §6.5 — cache strategy
 * @see docs/adr/0006-read-cache-strategy.md
 */

import type { ForecastInput, OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { TagId } from "../domain/ids.js";
import type { Task } from "../domain/task.js";
import { hashFilter } from "../pagination/cursor.js";

/** Minimal read-through cache surface needed by ForecastService. */
interface ReadCache {
  wrap<T>(key: string, factory: () => Promise<T>): Promise<T>;
  has(key: string): boolean;
}

export interface ForecastGetResult {
  overdue: Task[];
  dueToday: Task[];
  deferredToday: Task[];
  flagged: Task[];
  cacheHit: boolean;
}

export class ForecastService {
  private readonly adapter: OmniFocusAdapter;
  private readonly cache: ReadCache | undefined;

  constructor(deps: { adapter: OmniFocusAdapter; cache?: ReadCache }) {
    this.adapter = deps.adapter;
    this.cache = deps.cache;
  }

  /**
   * Fetch grouped forecast data for the given date range.
   *
   * All booleans default to `true` — callers opt out of categories they
   * don't need rather than opting in.
   */
  async get(input: ForecastInput): Promise<ForecastGetResult> {
    if (this.cache !== undefined) {
      const cacheKey = `forecast:${hashFilter(input as unknown as Record<string, unknown>)}`;
      const cacheHit = this.cache.has(cacheKey);
      const result = await this.cache.wrap(cacheKey, () => this.adapter.getForecast(input));
      return { ...result, cacheHit };
    }
    const result = await this.adapter.getForecast(input);
    return { ...result, cacheHit: false };
  }

  /**
   * Read the forecast-tag preference. Returns `null` for tagId/name when no
   * tag is configured. The paired name lets the agent describe the current
   * forecast tag without a follow-up `tag_get` (lever-4 round-trip
   * readability per docs/nl-quality-standards.md §4 / #599).
   *
   * Single composite round-trip (#849): the adapter folds the field read and
   * the tag-name lookup into one transport call. Previously this fanned out to
   * `getForecastTag()` (OmniJS) + `getTag(id)` (JXA) — two spawns across two
   * transports. The orphan case (tag deleted while still configured) cannot
   * arise: `Database.forecastTag` only resolves to a live tag or null, so the
   * returned name is always consistent with the id.
   *
   * @see #465 / #599 / #849
   */
  async getForecastTag(): Promise<{ tagId: TagId | null; name: string | null }> {
    return this.adapter.getForecastTagWithName();
  }

  /**
   * Set or clear the forecast-tag preference. Pass `null` to clear.
   * Returns the post-set state with the tag name paired (#599 lever 4).
   *
   * Single composite round-trip (#849) — see {@link getForecastTag}.
   *
   * @throws NotFound — when `tagId` is supplied but no tag with that ID exists
   * @see #465 / #599 / #849
   */
  async setForecastTag(tagId: TagId | null): Promise<{ tagId: TagId | null; name: string | null }> {
    return this.adapter.setForecastTagWithName(tagId);
  }
}
