/**
 * Unit tests for project_set_next_review_date — covers happy path, clear,
 * past-dated values, and cache-invalidation behavior on success/failure.
 */

import { describe, expect, it, vi } from "vitest";
import { ProjectId as ProjectIdCtor } from "../../domain/ids.js";
import { NotFound } from "../../errors/index.js";
import { ReviewService } from "../../services/reviewService.js";
import {
  handleProjectSetNextReviewDate,
  PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION,
  projectSetNextReviewDateInputSchema,
} from "./setNextReviewDate.js";

function makeCtx(opts: { setRejects?: Error; projectName?: string } = {}) {
  const setProjectNextReviewDate = vi.fn();
  if (opts.setRejects) {
    setProjectNextReviewDate.mockRejectedValue(opts.setRejects);
  } else {
    setProjectNextReviewDate.mockResolvedValue(undefined);
  }
  // The post-mutation getProject lookup powers the lever-4 name pairing (#607).
  // Tests inject the desired post-state via opts.projectName.
  const getProject = vi.fn().mockResolvedValue({
    id: PROJECT,
    name: opts.projectName ?? "Quarterly review",
    nextReviewDate: null,
  });
  const adapter = {
    setProjectNextReviewDate,
    getProject,
  } as unknown as ConstructorParameters<typeof ReviewService>[0]["adapter"];
  const cache = { invalidate: vi.fn() };
  return {
    reviewService: new ReviewService({ adapter, cache }),
    cache,
    makeMeta: () => ({}) as never,
    _setSpy: setProjectNextReviewDate,
    _getSpy: getProject,
  };
}

const PROJECT = ProjectIdCtor.of("proj-abc123");

describe("handleProjectSetNextReviewDate", () => {
  it("sets a future review date and invalidates the project cache", async () => {
    const ctx = makeCtx();
    const env = await handleProjectSetNextReviewDate(
      { projectId: PROJECT, nextReviewDate: "2026-12-31T00:00:00.000Z" },
      ctx,
    );
    expect(env.data).toMatchObject({ id: PROJECT, name: "Quarterly review" });
    expect(ctx._setSpy).toHaveBeenCalledWith(PROJECT, "2026-12-31T00:00:00.000Z");
    // invalidateProjectMutation issues multiple invalidations; assert at least
    // the project namespace is hit.
    expect(ctx.cache.invalidate).toHaveBeenCalled();
  });

  it("clears the review schedule when nextReviewDate is null", async () => {
    const ctx = makeCtx();
    const env = await handleProjectSetNextReviewDate(
      { projectId: PROJECT, nextReviewDate: null },
      ctx,
    );
    expect(env.data).toMatchObject({ id: PROJECT, name: "Quarterly review" });
    expect(ctx._setSpy).toHaveBeenCalledWith(PROJECT, null);
    expect(ctx.cache.invalidate).toHaveBeenCalled();
  });

  it("accepts past-dated values (matches OmniFocus UX of immediate overdue)", async () => {
    const ctx = makeCtx();
    const past = "2024-01-01T00:00:00.000Z";
    const env = await handleProjectSetNextReviewDate(
      { projectId: PROJECT, nextReviewDate: past },
      ctx,
    );
    expect(env.data).toMatchObject({ id: PROJECT, name: "Quarterly review" });
    expect(ctx._setSpy).toHaveBeenCalledWith(PROJECT, past);
  });

  it("propagates NotFound when the project does not exist", async () => {
    const ctx = makeCtx({ setRejects: new NotFound("Project not found: proj-missing") });
    await expect(
      handleProjectSetNextReviewDate(
        { projectId: ProjectIdCtor.of("proj-missing"), nextReviewDate: null },
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFound);
    // Cache must NOT be invalidated on failure
    expect(ctx.cache.invalidate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Name pairing (#607)
// ---------------------------------------------------------------------------

describe("project_set_next_review_date pairs name with id (#607)", () => {
  it("includes the project name and echoes nextReviewDate", async () => {
    const ctx = makeCtx({ projectName: "Annual review" });
    const env = await handleProjectSetNextReviewDate(
      { projectId: PROJECT, nextReviewDate: "2026-12-31T00:00:00.000Z" },
      ctx,
    );
    expect(env.data).toMatchObject({
      id: PROJECT,
      name: "Annual review",
      nextReviewDate: "2026-12-31T00:00:00.000Z",
    });
    expect(ctx._getSpy).toHaveBeenCalledWith(PROJECT);
  });

  it("name is null when the project orphans (lookup throws)", async () => {
    const ctx = makeCtx();
    ctx._getSpy.mockRejectedValueOnce(new Error("project not found"));
    const env = await handleProjectSetNextReviewDate(
      { projectId: PROJECT, nextReviewDate: null },
      ctx,
    );
    expect(env.data.name).toBeNull();
    expect(env.data.nextReviewDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Description examples must satisfy the schema
// ---------------------------------------------------------------------------

describe("project_set_next_review_date description examples", () => {
  it("every documented nextReviewDate example value passes the input schema", () => {
    // Tool descriptions are the LLM's contract — an example the schema
    // rejects costs every agent a failed round-trip.
    const examples = [
      ...PROJECT_SET_NEXT_REVIEW_DATE_DESCRIPTION.matchAll(/nextReviewDate: ("[^"]*"|null)/g),
    ].map((m) => JSON.parse(m[1] as string) as string | null);
    expect(examples.length).toBeGreaterThan(0);
    for (const nextReviewDate of examples) {
      const result = projectSetNextReviewDateInputSchema.safeParse({
        projectId: "prj123",
        nextReviewDate,
      });
      expect(result.success, `example value ${JSON.stringify(nextReviewDate)}`).toBe(true);
    }
  });
});
