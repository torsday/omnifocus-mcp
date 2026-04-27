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

export interface ForecastGetResult {
  overdue: Task[];
  dueToday: Task[];
  deferredToday: Task[];
  flagged: Task[];
  cacheHit: boolean;
}

export class ForecastService {
  private readonly adapter: OmniFocusAdapter;

  constructor(deps: { adapter: OmniFocusAdapter }) {
    this.adapter = deps.adapter;
  }

  /**
   * Fetch grouped forecast data for the given date range.
   *
   * All booleans default to `true` — callers opt out of categories they
   * don't need rather than opting in.
   */
  async get(input: ForecastInput): Promise<ForecastGetResult> {
    const result = await this.adapter.getForecast(input);
    return { ...result, cacheHit: false };
  }

  /**
   * Read the forecast-tag preference. Returns `null` when no tag is configured.
   * @see #465
   */
  async getForecastTag(): Promise<{ tagId: TagId | null }> {
    return this.adapter.getForecastTag();
  }

  /**
   * Set or clear the forecast-tag preference. Pass `null` to clear.
   * @throws NotFound — when `tagId` is supplied but no tag with that ID exists
   * @see #465
   */
  async setForecastTag(tagId: TagId | null): Promise<{ tagId: TagId | null }> {
    return this.adapter.setForecastTag(tagId);
  }
}
