/**
 * Unit tests for `JxaTransport` — project domain methods.
 *
 * All tests use a fake spawner that returns pre-shaped JSON, so no `osascript`
 * binary is required. Integration tests against a live OmniFocus instance are
 * in JxaTransport.projects.integration.test.ts and gated behind
 * `OMNIFOCUS_INTEGRATION=1`.
 *
 * @see src/adapter/jxa/JxaTransport.ts — implementation
 * @see src/scripts/jxa/project_*.js — underlying scripts
 */

import { describe, expect, it, vi } from "vitest";
import type { FolderId, ProjectId } from "../../domain/ids.js";
import { NotFound, ScriptError } from "../../errors/index.js";
import { JxaTransport } from "./JxaTransport.js";
import type { ScriptSpawner, SpawnResult } from "./scriptRunner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spawnerReturning(payload: unknown): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: JSON.stringify(payload),
      stderr: "",
      exitCode: 0,
      timedOut: false,
    }),
  );
}

function spawnerFailing(stderr: string): ScriptSpawner {
  return vi.fn(
    async (): Promise<SpawnResult> => ({
      stdout: "",
      stderr,
      exitCode: 1,
      timedOut: false,
    }),
  );
}

const BASE_PROJECT = {
  id: "proj_aaa",
  name: "My Project",
  note: null,
  noteHtml: null,
  folderId: null,
  tagIds: [],
  status: "active",
  flagged: false,
  deferDate: null,
  dueDate: null,
  completionDate: null,
  estimatedMinutes: null,
  numberOfTasks: 0,
  numberOfAvailableTasks: 0,
  numberOfCompletedTasks: 0,
  reviewIntervalDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

describe("JxaTransport — listProjects", () => {
  it("returns parsed projects with branded IDs", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ projects: [BASE_PROJECT] }) });
    const projects = await t.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe("proj_aaa");
    expect(projects[0]?.name).toBe("My Project");
    expect(projects[0]?.status).toBe("active");
  });

  it("passes folderId and status filters to the script", async () => {
    const spawner = spawnerReturning({ projects: [] });
    const t = new JxaTransport({ spawner });
    await t.listProjects({ folderId: "folder_xxx" as FolderId, status: "on-hold" });
    const call = (spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const arg = JSON.parse(call[1] as string) as { folderId: string; status: string };
    expect(arg.folderId).toBe("folder_xxx");
    expect(arg.status).toBe("on-hold");
  });

  it("returns empty array when no projects", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ projects: [] }) });
    expect(await t.listProjects()).toEqual([]);
  });

  it("surfaces ScriptError on script failure", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("OmniFocus got an error") });
    await expect(t.listProjects()).rejects.toBeInstanceOf(ScriptError);
  });
});

// ---------------------------------------------------------------------------
// getProject
// ---------------------------------------------------------------------------

describe("JxaTransport — getProject", () => {
  it("returns a single project", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ project: BASE_PROJECT }) });
    const project = await t.getProject("proj_aaa" as ProjectId);
    expect(project.id).toBe("proj_aaa");
    expect(project.name).toBe("My Project");
    expect(project.flagged).toBe(false);
  });

  it("passes the id to the script", async () => {
    const spawner = spawnerReturning({ project: BASE_PROJECT });
    const t = new JxaTransport({ spawner });
    await t.getProject("proj_aaa" as ProjectId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string };
    expect(arg.id).toBe("proj_aaa");
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("project not found") });
    await expect(t.getProject("proj_missing" as ProjectId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe("JxaTransport — createProject", () => {
  it("returns the new project's branded ID", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ project: BASE_PROJECT }) });
    const id = await t.createProject({ name: "My Project" });
    expect(id).toBe("proj_aaa");
  });

  it("passes name and null folderId when none supplied", async () => {
    const spawner = spawnerReturning({ project: BASE_PROJECT });
    const t = new JxaTransport({ spawner });
    await t.createProject({ name: "My Project" });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { name: string; folderId: null };
    expect(arg.name).toBe("My Project");
    expect(arg.folderId).toBeNull();
  });

  it("passes folderId when supplied", async () => {
    const spawner = spawnerReturning({ project: BASE_PROJECT });
    const t = new JxaTransport({ spawner });
    await t.createProject({ name: "My Project", folderId: "folder_yyy" as FolderId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { folderId: string };
    expect(arg.folderId).toBe("folder_yyy");
  });
});

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe("JxaTransport — updateProject", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({
      spawner: spawnerReturning({ project: { ...BASE_PROJECT, name: "Updated" } }),
    });
    await expect(
      t.updateProject("proj_aaa" as ProjectId, { name: "Updated" }),
    ).resolves.toBeUndefined();
  });

  it("passes only supplied patch fields to the script", async () => {
    const spawner = spawnerReturning({ project: BASE_PROJECT });
    const t = new JxaTransport({ spawner });
    await t.updateProject("proj_aaa" as ProjectId, { flagged: true });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; flagged: boolean; name?: string };
    expect(arg.id).toBe("proj_aaa");
    expect(arg.flagged).toBe(true);
    expect(arg.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// completeProject
// ---------------------------------------------------------------------------

describe("JxaTransport — completeProject", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "proj_aaa" }) });
    await expect(t.completeProject("proj_aaa" as ProjectId)).resolves.toBeUndefined();
  });

  it("passes id and null completionDate when none supplied", async () => {
    const spawner = spawnerReturning({ id: "proj_aaa" });
    const t = new JxaTransport({ spawner });
    await t.completeProject("proj_aaa" as ProjectId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; completionDate: string | null };
    expect(arg.id).toBe("proj_aaa");
    expect(arg.completionDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dropProject
// ---------------------------------------------------------------------------

describe("JxaTransport — dropProject", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "proj_aaa" }) });
    await expect(t.dropProject("proj_aaa" as ProjectId)).resolves.toBeUndefined();
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("project not found") });
    await expect(t.dropProject("proj_missing" as ProjectId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// moveProject
// ---------------------------------------------------------------------------

describe("JxaTransport — moveProject", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "proj_aaa" }) });
    await expect(
      t.moveProject("proj_aaa" as ProjectId, { folderId: "folder_zzz" as FolderId }),
    ).resolves.toBeUndefined();
  });

  it("passes id and folderId to the script", async () => {
    const spawner = spawnerReturning({ id: "proj_aaa" });
    const t = new JxaTransport({ spawner });
    await t.moveProject("proj_aaa" as ProjectId, { folderId: "folder_zzz" as FolderId });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string; folderId: string };
    expect(arg.id).toBe("proj_aaa");
    expect(arg.folderId).toBe("folder_zzz");
  });

  it("passes null folderId when moving to top level", async () => {
    const spawner = spawnerReturning({ id: "proj_aaa" });
    const t = new JxaTransport({ spawner });
    await t.moveProject("proj_aaa" as ProjectId, { folderId: null });
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { folderId: null };
    expect(arg.folderId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

describe("JxaTransport — deleteProject", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "proj_aaa" }) });
    await expect(t.deleteProject("proj_aaa" as ProjectId)).resolves.toBeUndefined();
  });

  it("surfaces NotFound on not-found", async () => {
    const t = new JxaTransport({ spawner: spawnerFailing("project not found") });
    await expect(t.deleteProject("proj_missing" as ProjectId)).rejects.toBeInstanceOf(NotFound);
  });
});

// ---------------------------------------------------------------------------
// markProjectReviewed
// ---------------------------------------------------------------------------

describe("JxaTransport — markProjectReviewed", () => {
  it("resolves without error on success", async () => {
    const t = new JxaTransport({ spawner: spawnerReturning({ id: "proj_aaa" }) });
    await expect(t.markProjectReviewed("proj_aaa" as ProjectId)).resolves.toBeUndefined();
  });

  it("passes id to the script", async () => {
    const spawner = spawnerReturning({ id: "proj_aaa" });
    const t = new JxaTransport({ spawner });
    await t.markProjectReviewed("proj_aaa" as ProjectId);
    const arg = JSON.parse(
      ((spawner as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string])[1],
    ) as { id: string };
    expect(arg.id).toBe("proj_aaa");
  });
});
