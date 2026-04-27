/**
 * Unit tests for the taxonomy-audit resource.
 *
 * Tests cover:
 * - `buildTaxonomyAuditPayload` — tag collision detection (all reason types)
 * - `buildTaxonomyAuditPayload` — project collision detection
 * - Clustering: three-way collision merges into one cluster
 * - Empty collections return empty arrays
 * - folderPath preserved in project candidates
 *
 * Uses InMemoryAdapter seeded with predictable fixtures.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { buildTaxonomyAuditPayload } from "./taxonomyAudit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedTags(adapter: InMemoryAdapter, names: string[]): Promise<void> {
  for (const name of names) {
    await adapter.createTag({ name });
  }
}

async function seedProjects(adapter: InMemoryAdapter, names: string[]): Promise<void> {
  for (const name of names) {
    await adapter.createProject({ name, status: "active" });
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("buildTaxonomyAuditPayload — empty adapter", () => {
  it("returns empty arrays", async () => {
    const adapter = new InMemoryAdapter();
    const payload = await buildTaxonomyAuditPayload(adapter);
    expect(payload.tagCollisions).toEqual([]);
    expect(payload.projectCollisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tag collisions
// ---------------------------------------------------------------------------

describe("buildTaxonomyAuditPayload — tagCollisions", () => {
  it("detects exact-duplicate tags", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["Work", "Work"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(tagCollisions).toHaveLength(1);
    expect(tagCollisions[0]?.reason).toBe("exact-duplicate");
    expect(tagCollisions[0]?.candidates).toHaveLength(2);
  });

  it("detects case-difference tags", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["errand", "Errand"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(tagCollisions).toHaveLength(1);
    expect(tagCollisions[0]?.reason).toBe("case-difference");
  });

  it("detects plural-singular tags (@errand / @errands)", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["@errand", "@errands"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(tagCollisions).toHaveLength(1);
    expect(tagCollisions[0]?.reason).toBe("plural-singular");
  });

  it("detects near-duplicate tags (Levenshtein ≤ 2)", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["hom", "home"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(tagCollisions).toHaveLength(1);
    expect(tagCollisions[0]?.reason).toBe("near-duplicate");
  });

  it("does not flag unrelated tags", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["groceries", "finances", "health"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);
    expect(tagCollisions).toEqual([]);
  });

  it("clusters a three-way collision into one entry", async () => {
    // "errand", "errands", "Errand" — all collide with each other
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["errand", "errands", "Errand"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);

    // All three should be in one cluster
    expect(tagCollisions).toHaveLength(1);
    expect(tagCollisions[0]?.candidates).toHaveLength(3);
  });

  it("includes tagId and taskCount in candidates", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["Work", "work"]);

    const { tagCollisions } = await buildTaxonomyAuditPayload(adapter);
    const candidate = tagCollisions[0]?.candidates[0];
    expect(candidate).toHaveProperty("tagId");
    expect(candidate).toHaveProperty("name");
    expect(candidate).toHaveProperty("taskCount");
  });
});

// ---------------------------------------------------------------------------
// Project collisions
// ---------------------------------------------------------------------------

describe("buildTaxonomyAuditPayload — projectCollisions", () => {
  it("detects case-difference project names", async () => {
    const adapter = new InMemoryAdapter();
    await seedProjects(adapter, ["Taxes 2025", "taxes 2025"]);

    const { projectCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(projectCollisions).toHaveLength(1);
    expect(projectCollisions[0]?.reason).toBe("case-difference");
  });

  it("detects near-duplicate project names (token-set)", async () => {
    const adapter = new InMemoryAdapter();
    await seedProjects(adapter, ["2025 Taxes", "Taxes 2025"]);

    const { projectCollisions } = await buildTaxonomyAuditPayload(adapter);

    expect(projectCollisions).toHaveLength(1);
    expect(projectCollisions[0]?.reason).toBe("near-duplicate");
  });

  it("does not flag unrelated project names", async () => {
    const adapter = new InMemoryAdapter();
    await seedProjects(adapter, ["Garden Renovation", "Home Office Setup", "Side Project Alpha"]);

    const { projectCollisions } = await buildTaxonomyAuditPayload(adapter);
    expect(projectCollisions).toEqual([]);
  });

  it("includes folderId in project candidates", async () => {
    const adapter = new InMemoryAdapter();
    await seedProjects(adapter, ["Work", "work"]);

    const { projectCollisions } = await buildTaxonomyAuditPayload(adapter);
    const candidate = projectCollisions[0]?.candidates[0];
    expect(candidate).toHaveProperty("projectId");
    expect(candidate).toHaveProperty("folderId");
    expect(candidate).toHaveProperty("taskCount");
  });
});

// ---------------------------------------------------------------------------
// Both sections populated simultaneously
// ---------------------------------------------------------------------------

describe("buildTaxonomyAuditPayload — mixed", () => {
  it("detects collisions in both tags and projects independently", async () => {
    const adapter = new InMemoryAdapter();
    await seedTags(adapter, ["errand", "errands"]);
    await seedProjects(adapter, ["Work", "work"]);

    const payload = await buildTaxonomyAuditPayload(adapter);

    expect(payload.tagCollisions).toHaveLength(1);
    expect(payload.projectCollisions).toHaveLength(1);
  });
});
