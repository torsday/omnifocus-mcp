/**
 * `ReviewService` — service layer for review operations.
 */
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import { type InvalidatingCache, invalidateProjectMutation } from "../cache/invalidation.js";
import type { ProjectId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";

export interface ReviewListResult {
  projects: Project[];
  cacheHit: boolean;
}

/**
 * Outcome of `markReviewed` — project name plus the post-mutation review
 * dates so the caller can describe the change without a follow-up read
 * (lever-4 round-trip readability per docs/nl-quality-standards.md §4 / #607).
 *
 * `name` is `null` only when the project has been deleted between the
 * mutation and the lookup — surface the orphan rather than failing.
 */
export interface ReviewMarkReviewedOutcome {
  name: string | null;
  lastReviewDate: string | null;
  nextReviewDate: string | null;
}

export interface ReviewSetIntervalOutcome {
  name: string | null;
  reviewIntervalDays: number | null;
}

export interface ReviewSetNextReviewDateOutcome {
  name: string | null;
  nextReviewDate: string | null;
}

export class ReviewService {
  private readonly adapter: OmniFocusAdapter;
  private readonly cache: InvalidatingCache | undefined;

  constructor(deps: { adapter: OmniFocusAdapter; cache?: InvalidatingCache }) {
    this.adapter = deps.adapter;
    this.cache = deps.cache;
  }

  async listDue(): Promise<ReviewListResult> {
    const projects = await this.adapter.listProjectsDueForReview();
    return { projects, cacheHit: false };
  }

  async markReviewed(id: ProjectId): Promise<ReviewMarkReviewedOutcome> {
    await this.adapter.markProjectReviewed(id);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
    const post = await this.lookupProject(id);
    return {
      name: post?.name ?? null,
      lastReviewDate: post?.lastReviewDate ?? null,
      nextReviewDate: post?.nextReviewDate ?? null,
    };
  }

  async setInterval(id: ProjectId, days: number | null): Promise<ReviewSetIntervalOutcome> {
    await this.adapter.setProjectReviewInterval(id, days);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
    const post = await this.lookupProject(id);
    return {
      name: post?.name ?? null,
      // Echo the requested value when the post-read is missing the field —
      // the adapter accepted the mutation, so days reflects the new state.
      reviewIntervalDays: post?.reviewIntervalDays ?? days,
    };
  }

  /**
   * Set the project's next review date directly. Pass `null` to clear.
   * Past-dated values surface the project as overdue immediately — matches OF UX.
   *
   * @throws NotFound — when no project with this ID exists
   * @see #467
   */
  async setNextReviewDate(
    id: ProjectId,
    nextReviewDate: string | null,
  ): Promise<ReviewSetNextReviewDateOutcome> {
    await this.adapter.setProjectNextReviewDate(id, nextReviewDate);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
    const post = await this.lookupProject(id);
    return {
      name: post?.name ?? null,
      nextReviewDate: post?.nextReviewDate ?? nextReviewDate,
    };
  }

  /** Resolve a project id to its post-mutation snapshot; null on orphan/deleted. */
  private async lookupProject(id: ProjectId): Promise<Project | null> {
    try {
      return await this.adapter.getProject(id);
    } catch {
      return null;
    }
  }
}
