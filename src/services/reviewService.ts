/**
 * `ReviewService` — service layer for review operations.
 */
import type { OmniFocusAdapter } from "../adapter/OmniFocusAdapter.js";
import type { ProjectId } from "../domain/ids.js";
import type { Project } from "../domain/project.js";

export interface ReviewListResult {
  projects: Project[];
  cacheHit: boolean;
}

export class ReviewService {
  private readonly adapter: OmniFocusAdapter;
  constructor(deps: { adapter: OmniFocusAdapter }) {
    this.adapter = deps.adapter;
  }

  async listDue(): Promise<ReviewListResult> {
    const projects = await this.adapter.listProjectsDueForReview();
    return { projects, cacheHit: false };
  }

  async markReviewed(id: ProjectId): Promise<void> {
    await this.adapter.markProjectReviewed(id);
  }

  async setInterval(id: ProjectId, days: number | null): Promise<void> {
    await this.adapter.setProjectReviewInterval(id, days);
  }
}
