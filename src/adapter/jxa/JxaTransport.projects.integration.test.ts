/**
 * Integration tests for `JxaTransport` — project domain methods.
 *
 * These tests require a running OmniFocus instance and are gated behind the
 * `OMNIFOCUS_INTEGRATION=1` environment variable. They exercise real JXA
 * calls via `osascript` rather than a mocked spawner.
 *
 * Run with:
 *   OMNIFOCUS_INTEGRATION=1 pnpm test:integration
 *
 * @see src/adapter/jxa/JxaTransport.projects.test.ts — unit tests (no OF required)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProjectId } from "../../domain/ids.js";
import { JxaTransport } from "./JxaTransport.js";

const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("JxaTransport — project integration", () => {
  const t = new JxaTransport();
  let createdProjectId: ProjectId;

  beforeAll(async () => {
    createdProjectId = await t.createProject({ name: "__mcp_test_project__" });
  });

  afterAll(async () => {
    if (createdProjectId) {
      await t.deleteProject(createdProjectId).catch(() => {
        /* already deleted */
      });
    }
  });

  it("createProject returns a valid ID", () => {
    expect(typeof createdProjectId).toBe("string");
    expect(createdProjectId.length).toBeGreaterThan(0);
  });

  it("getProject returns the created project", async () => {
    const project = await t.getProject(createdProjectId);
    expect(project.id).toBe(createdProjectId);
    expect(project.name).toBe("__mcp_test_project__");
    expect(project.status).toBe("active");
  });

  it("listProjects includes the created project", async () => {
    const projects = await t.listProjects();
    const found = projects.find((p) => p.id === createdProjectId);
    expect(found).toBeDefined();
    expect(found?.name).toBe("__mcp_test_project__");
  });

  it("updateProject renames the project", async () => {
    await t.updateProject(createdProjectId, { name: "__mcp_test_project_renamed__" });
    const project = await t.getProject(createdProjectId);
    expect(project.name).toBe("__mcp_test_project_renamed__");
  });

  it("markProjectReviewed does not throw", async () => {
    await expect(t.markProjectReviewed(createdProjectId)).resolves.toBeUndefined();
  });

  it("dropProject drops the project", async () => {
    await t.dropProject(createdProjectId);
    const project = await t.getProject(createdProjectId);
    expect(project.status).toBe("dropped");
  });

  it("deleteProject removes the project", async () => {
    await t.deleteProject(createdProjectId);
    const projects = await t.listProjects();
    const found = projects.find((p) => p.id === createdProjectId);
    expect(found).toBeUndefined();
  });
});
