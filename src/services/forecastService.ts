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
   * Read the forecast-tag preference. Returns `null` for tagId/name when no
   * tag is configured. The paired name lets the agent describe the current
   * forecast tag without a follow-up `tag_get` (lever-4 round-trip
   * readability per docs/nl-quality-standards.md §4 / #599).
   *
   * If the configured tag has been deleted between read and lookup, name is
   * null — surface the orphan rather than failing the whole call.
   *
   * @see #465 / #599
   */
  async getForecastTag(): Promise<{ tagId: TagId | null; name: string | null }> {
    const { tagId } = await this.adapter.getForecastTag();
    return { tagId, name: await this.lookupTagName(tagId) };
  }

  /**
   * Set or clear the forecast-tag preference. Pass `null` to clear.
   * Returns the post-set state with the tag name paired (#599 lever 4).
   *
   * @throws NotFound — when `tagId` is supplied but no tag with that ID exists
   * @see #465 / #599
   */
  async setForecastTag(tagId: TagId | null): Promise<{ tagId: TagId | null; name: string | null }> {
    const { tagId: appliedId } = await this.adapter.setForecastTag(tagId);
    return { tagId: appliedId, name: await this.lookupTagName(appliedId) };
  }

  /** Resolve a tag id to its display name; null when id is null or the tag is missing. */
  private async lookupTagName(tagId: TagId | null): Promise<string | null> {
    if (tagId === null) return null;
    try {
      const tag = await this.adapter.getTag(tagId);
      return tag.name;
    } catch {
      // Tag may have been deleted between read and lookup; treat as orphan.
      return null;
    }
  }
}
