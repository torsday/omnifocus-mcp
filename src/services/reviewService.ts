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

  async markReviewed(id: ProjectId): Promise<void> {
    await this.adapter.markProjectReviewed(id);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
  }

  async setInterval(id: ProjectId, days: number | null): Promise<void> {
    await this.adapter.setProjectReviewInterval(id, days);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
  }

  /**
   * Set the project's next review date directly. Pass `null` to clear.
   * Past-dated values surface the project as overdue immediately — matches OF UX.
   *
   * @throws NotFound — when no project with this ID exists
   * @see #467
   */
  async setNextReviewDate(id: ProjectId, nextReviewDate: string | null): Promise<void> {
    await this.adapter.setProjectNextReviewDate(id, nextReviewDate);
    if (this.cache !== undefined) {
      invalidateProjectMutation(this.cache, { projectId: id });
    }
  }
}
