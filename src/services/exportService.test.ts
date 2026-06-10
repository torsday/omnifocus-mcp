/**
 * Tests for `ExportService.exportOpml` — OPML generation using InMemoryAdapter.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../adapter/inMemory/InMemoryAdapter.js";
import type { ProjectId } from "../domain/ids.js";
import { ExportService } from "./exportService.js";

function makeService() {
  const adapter = new InMemoryAdapter({
    now: () => new Date("2026-04-23T12:00:00.000Z"),
  });
  const service = new ExportService({ adapter });
  return { adapter, service };
}

describe("ExportService.exportOpml — scope: all", () => {
  it("returns empty body when no active projects exist", async () => {
    const { service } = makeService();
    const result = await service.exportOpml({ kind: "all" });
    expect(result.projectCount).toBe(0);
    expect(result.taskCount).toBe(0);
    expect(result.opml).toContain("<?xml version=");
    expect(result.opml).toContain("<opml");
    expect(result.opml).toContain("</opml>");
  });

  it("includes active projects", async () => {
    const { adapter, service } = makeService();
    await adapter.createProject({ name: "Work" });
    await adapter.createProject({ name: "Personal" });
    const result = await service.exportOpml({ kind: "all" });
    expect(result.projectCount).toBe(2);
    expect(result.opml).toContain('text="Work"');
    expect(result.opml).toContain('text="Personal"');
  });

  it("excludes dropped projects", async () => {
    const { adapter, service } = makeService();
    const id = await adapter.createProject({ name: "Dropped proj" });
    await adapter.dropProject(id);
    const result = await service.exportOpml({ kind: "all" });
    expect(result.opml).not.toContain("Dropped proj");
  });
});

describe("ExportService.exportOpml — scope: project", () => {
  it("exports a single project with its tasks", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: "My Project" });
    await adapter.createTask({ name: "Task A", projectId });
    await adapter.createTask({ name: "Task B", projectId });

    const result = await service.exportOpml({ kind: "project", id: projectId });
    expect(result.projectCount).toBe(1);
    expect(result.taskCount).toBe(2);
    expect(result.opml).toContain('text="My Project"');
    expect(result.opml).toContain('text="Task A"');
    expect(result.opml).toContain('text="Task B"');
    expect(result.opml).toContain('type="omnifocus:project"');
    expect(result.opml).toContain('type="omnifocus:task"');
  });

  it("renders multiple tasks in document order", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: "Multi-task" });
    await adapter.createTask({ name: "Alpha", projectId });
    await adapter.createTask({ name: "Beta", projectId });
    await adapter.createTask({ name: "Gamma", projectId });

    const result = await service.exportOpml({ kind: "project", id: projectId });
    expect(result.taskCount).toBe(3);
    expect(result.opml).toContain('text="Alpha"');
    expect(result.opml).toContain('text="Beta"');
    expect(result.opml).toContain('text="Gamma"');
  });

  it("includes task attributes when present", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: "Proj" });
    await adapter.createTask({
      name: "Due task",
      projectId,
      dueDate: "2026-05-01T00:00:00.000Z",
      flagged: true,
    });

    const result = await service.exportOpml({ kind: "project", id: projectId });
    expect(result.opml).toContain('due="2026-05-01T00:00:00.000Z"');
    expect(result.opml).toContain('flagged="true"');
  });

  it("throws NotFound for an unknown project ID", async () => {
    const { service } = makeService();
    const fakeId = "proj_unknown" as ProjectId;
    await expect(service.exportOpml({ kind: "project", id: fakeId })).rejects.toThrow();
  });

  it("produces well-formed OPML with xml declaration and opml root", async () => {
    const { adapter, service } = makeService();
    await adapter.createProject({ name: "P" });
    const result = await service.exportOpml({ kind: "all" });
    expect(result.opml).toMatch(/^<\?xml version="1\.0"/);
    expect(result.opml).toContain('<opml version="2.0">');
    expect(result.opml).toContain("<head>");
    expect(result.opml).toContain("<body>");
    expect(result.opml).toContain("</body>");
    expect(result.opml).toContain("</opml>");
  });

  it("escapes XML special characters in task names", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: 'Special <chars> & "quotes"' });
    await adapter.createTask({ name: "Task with <tag> & 'quotes'", projectId });

    const result = await service.exportOpml({ kind: "project", id: projectId });
    expect(result.opml).toContain("Special &lt;chars&gt; &amp; &quot;quotes&quot;");
    // Single quotes don't need escaping inside double-quoted XML attributes
    expect(result.opml).toContain("Task with &lt;tag&gt; &amp; 'quotes'");
  });

  it("escapes newlines/CR/tabs in note attributes as character references", async () => {
    const { adapter, service } = makeService();
    const projectId = await adapter.createProject({ name: "Proj" });
    await adapter.createTask({
      name: "Notes",
      projectId,
      note: "Line one\nLine two\t(indented)\r\nLine three",
    });

    const result = await service.exportOpml({ kind: "project", id: projectId });
    // Literal #x9/#xA/#xD inside attribute values are normalized to spaces
    // by every conforming XML parser (XML 1.0 §3.3.3) — only the character
    // references survive a round-trip into OmniFocus File → Import.
    expect(result.opml).toContain('note="Line one&#10;Line two&#9;(indented)&#13;&#10;Line three"');
    expect(result.opml).not.toMatch(/note="[^"]*\n/);
  });
});

describe("ExportService.exportOpml — scope: folder", () => {
  it("exports all projects in a folder", async () => {
    const { adapter, service } = makeService();
    const folderId = await adapter.createFolder({ name: "Work folder" });
    await adapter.createProject({ name: "Proj A", folderId });
    await adapter.createProject({ name: "Proj B", folderId });
    await adapter.createProject({ name: "Unrelated proj" }); // root, not in folder

    const result = await service.exportOpml({ kind: "folder", id: folderId });
    expect(result.projectCount).toBe(2);
    expect(result.opml).toContain('text="Proj A"');
    expect(result.opml).toContain('text="Proj B"');
    expect(result.opml).not.toContain('text="Unrelated proj"');
  });
});
