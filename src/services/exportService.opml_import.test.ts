/**
 * Tests for `ExportService.importOpml` — OPML import using InMemoryAdapter.
 *
 * Covers:
 * - Basic single-task import (inbox)
 * - Project-matched import by OmniFocus ID (round-trip)
 * - Project-matched import by name fallback
 * - Nested task hierarchy (subtasks)
 * - destinationProjectId override
 * - Malformed XML → ValidationError
 * - Empty OPML string → ValidationError
 * - Round-trip: export_opml → import_opml preserves task names and hierarchy
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import { ExportService } from "./exportService.js";

function makeService() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const service = new ExportService({ adapter });
  return { adapter, service };
}

describe("ExportService.importOpml — validation", () => {
  it("throws ValidationError for empty input", async () => {
    const { service } = makeService();
    await expect(service.importOpml("   ")).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });

  it("throws ValidationError for non-XML input", async () => {
    const { service } = makeService();
    await expect(service.importOpml("not xml at all")).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });

  it("throws ValidationError for XML without <opml> root", async () => {
    const { service } = makeService();
    await expect(service.importOpml("<root><body></body></root>")).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });

  it("throws ValidationError for OPML without <body>", async () => {
    const { service } = makeService();
    await expect(service.importOpml('<opml version="2.0"><head/></opml>')).rejects.toMatchObject({
      code: "OF_VALIDATION",
    });
  });
});

describe("ExportService.importOpml — basic import", () => {
  it("imports a single task into inbox when no project context", async () => {
    const { service } = makeService();
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Buy milk" />
  </body>
</opml>`;

    const result = await service.importOpml(opml);
    expect(result.imported).toBe(1);
    expect(result.taskIds).toHaveLength(1);
  });

  it("returns imported count and task IDs", async () => {
    const { service } = makeService();
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Task One" />
    <outline text="Task Two" />
    <outline text="Task Three" />
  </body>
</opml>`;

    const result = await service.importOpml(opml);
    expect(result.imported).toBe(3);
    expect(result.taskIds).toHaveLength(3);
  });
});

describe("ExportService.importOpml — project matching", () => {
  it("imports tasks into a matched project by name", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: "Work" });

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Work" type="omnifocus:project">
      <outline text="Write report" type="omnifocus:task" />
      <outline text="Send email" type="omnifocus:task" />
    </outline>
  </body>
</opml>`;

    const result = await service.importOpml(opml);
    expect(result.imported).toBe(2);

    // Tasks should be in the Work project
    const tasks = await adapter.listTasks({ projectId });
    expect(tasks.map((t) => t.name)).toEqual(
      expect.arrayContaining(["Write report", "Send email"]),
    );
  });

  it("falls back to inbox for unrecognised project outlines", async () => {
    const { service } = makeService();
    // No projects in the adapter

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Unknown Project" type="omnifocus:project">
      <outline text="Orphan task" type="omnifocus:task" />
    </outline>
  </body>
</opml>`;

    // Should not throw — unmatched project tasks land in inbox
    const result = await service.importOpml(opml);
    expect(result.imported).toBe(1);
  });

  it("imports into destinationProjectId when supplied, ignoring project outlines", async () => {
    const { adapter, service } = makeService();
    const destId = await adapter.createProject({ name: "Destination" });

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Other Project" type="omnifocus:project">
      <outline text="Task A" type="omnifocus:task" />
    </outline>
  </body>
</opml>`;

    const result = await service.importOpml(opml, { destinationProjectId: destId });
    expect(result.imported).toBe(2); // project outline itself + Task A child

    // Look up tasks by the returned IDs to verify names
    const taskNames = await Promise.all(
      result.taskIds.map((id) => adapter.getTask(id).then((t) => t.name)),
    );
    expect(taskNames).toContain("Task A");
  });
});

describe("ExportService.importOpml — hierarchy", () => {
  it("preserves subtask nesting", async () => {
    const { adapter, service } = makeService();
    await adapter.createProject({ name: "Deep Work" });

    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Deep Work" type="omnifocus:project">
      <outline text="Parent task" type="omnifocus:task">
        <outline text="Child task" type="omnifocus:task" />
      </outline>
    </outline>
  </body>
</opml>`;

    const result = await service.importOpml(opml);
    expect(result.imported).toBe(2);

    // Fetch both tasks by ID (child tasks have parentId not projectId, so
    // listTasks by projectId won't find them — look up directly).
    const [rawParentId, rawChildId] = result.taskIds;
    if (!rawParentId || !rawChildId) throw new Error("Expected 2 task IDs");
    const parent = await adapter.getTask(rawParentId);
    const child = await adapter.getTask(rawChildId);
    expect(parent.name).toBe("Parent task");
    expect(child.name).toBe("Child task");
    // Child should have the parent's id as its parentId
    expect(String(child.parentId)).toBe(String(parent.id));
  });
});

describe("ExportService — OPML round-trip", () => {
  it("export then import preserves task names and project structure", async () => {
    const { adapter, service } = makeService();

    // Set up: one project with two tasks
    const projectId = await adapter.createProject({ name: "Round Trip" });
    await adapter.createTask({ name: "Alpha", projectId });
    await adapter.createTask({ name: "Beta", projectId });

    // Export
    const exported = await service.exportOpml({ kind: "project", id: projectId });
    expect(exported.opml).toContain("Round Trip");
    expect(exported.opml).toContain("Alpha");
    expect(exported.opml).toContain("Beta");

    // Create a fresh service/adapter for import
    const { adapter: adapter2, service: service2 } = makeService();
    await adapter2.createProject({ name: "Round Trip" }); // same name for matching

    const importResult = await service2.importOpml(exported.opml);
    expect(importResult.imported).toBe(2);

    // Verify task names landed correctly
    const projects = await adapter2.listProjects();
    const proj = projects.find((p) => p.name === "Round Trip");
    expect(proj).toBeDefined();
    if (proj) {
      const tasks = await adapter2.listTasks({ projectId: proj.id });
      expect(tasks.map((t) => t.name)).toEqual(expect.arrayContaining(["Alpha", "Beta"]));
    }
  });
});
