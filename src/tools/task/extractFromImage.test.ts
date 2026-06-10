/**
 * Unit tests for `task_extract_from_image`.
 *
 * Covers source validation (path / attachment, image vs non-image),
 * the dry-run preview path, the three `attachSourceTo` modes, and
 * confirmation enforcement.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { AttachmentId, ProjectId, TaskId } from "../../domain/ids.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import { AttachmentService } from "../../services/attachmentService.js";

import { handleTaskExtractFromImage, taskExtractFromImageInputSchema } from "./extractFromImage.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const META: ResponseMeta = {
  correlationId: "01TESTEXTRACTFROMIMAGE",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "unknown",
};

function makeCtx(adapter: InMemoryAdapter) {
  const attachmentService = new AttachmentService({
    adapter,
    allowedPaths: [tmpdir(), "/private/var/folders", "/var/folders"],
    maxAttachmentMb: 100,
  });
  return {
    adapter,
    attachmentService,
    makeMeta: (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({ ...META, ...partial }),
  };
}

async function makeTempImage(ext = ".png"): Promise<string> {
  const p = join(tmpdir(), `omnifocus-mcp-486-${randomUUID()}${ext}`);
  // 1×1 PNG header + body — just enough to be a non-empty real file. The
  // tool doesn't crack image bytes; assertAttachmentPath only needs realpath.
  await writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return p;
}

const PROPOSED = [{ name: "Buy paint" }, { name: "Patch drywall", note: "Use the tan filler" }];

// ---------------------------------------------------------------------------
// Schema enforcement
// ---------------------------------------------------------------------------

describe("taskExtractFromImageInputSchema", () => {
  it("requires confirmation[] when dryRun is false", () => {
    expect(() =>
      taskExtractFromImageInputSchema.parse({
        source: { kind: "path", imagePath: "/tmp/x.png" },
        targetProjectId: "proj_001",
        proposed: [{ name: "X" }],
        dryRun: false,
      }),
    ).toThrow(/confirmation/);
  });

  it("requires exactly one owner field on attachment-mode source", () => {
    expect(() =>
      taskExtractFromImageInputSchema.parse({
        source: { kind: "attachment", attachmentId: "att_001" },
        targetProjectId: "proj_001",
        proposed: [{ name: "X" }],
      }),
    ).toThrow(/owner/);
    expect(() =>
      taskExtractFromImageInputSchema.parse({
        source: {
          kind: "attachment",
          attachmentId: "att_001",
          ownerTaskId: "task_001",
          ownerProjectId: "proj_001",
        },
        targetProjectId: "proj_001",
        proposed: [{ name: "X" }],
      }),
    ).toThrow(/owner/);
  });

  it("accepts a minimal path-mode dry-run input", () => {
    const parsed = taskExtractFromImageInputSchema.parse({
      source: { kind: "path", imagePath: "/tmp/x.png" },
      targetProjectId: "proj_001",
      proposed: [{ name: "X" }],
    });
    expect(parsed.dryRun).toBe(true);
    expect(parsed.attachSourceTo).toBe("parent-task");
  });
});

// ---------------------------------------------------------------------------
// Dry-run path
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — dry run", () => {
  it("validates a real image path and echoes proposed without creating", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const imagePath = await makeTempImage();

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "path", imagePath },
        targetProjectId: projId,
        proposed: PROPOSED,
        attachSourceTo: "parent-task",
        dryRun: true,
      },
      makeCtx(adapter),
    );

    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.phase).toBe("dryRun");
    if (env.data.phase !== "dryRun") return;
    expect(env.data.proposed).toEqual(PROPOSED);
    expect(env.data.sourceKind).toBe("path");

    const after = (await adapter.listTasks({ projectId: projId })).length;
    expect(after).toBe(0);
  });

  it("rejects an unsupported extension with a clear error", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const txtPath = join(tmpdir(), `omnifocus-mcp-486-${randomUUID()}.txt`);
    await writeFile(txtPath, "not an image");

    let caught: unknown;
    try {
      await handleTaskExtractFromImage(
        {
          source: { kind: "path", imagePath: txtPath },
          targetProjectId: projId,
          proposed: PROPOSED,
          attachSourceTo: "none",
          dryRun: true,
        },
        makeCtx(adapter),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const failures = (caught as { details?: { failures?: Array<{ expected: string }> } }).details
      ?.failures;
    expect(failures?.some((f) => /imagePath must use one of/.test(f.expected))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path validation precedes any write (no orphaned wrapper task)
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — path validation precedes writes", () => {
  it("dry run rejects a nonexistent / out-of-scope path instead of approving it", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });

    await expect(
      handleTaskExtractFromImage(
        {
          source: { kind: "path", imagePath: "/etc/omnifocus-mcp-486-nonexistent.png" },
          targetProjectId: projId,
          proposed: PROPOSED,
          attachSourceTo: "parent-task",
          dryRun: true,
        },
        makeCtx(adapter),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("write phase fails before creating the wrapper task when the path is invalid", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    // In-scope directory, but the file was never written.
    const missingPath = join(tmpdir(), `omnifocus-mcp-486-${randomUUID()}.png`);

    await expect(
      handleTaskExtractFromImage(
        {
          source: { kind: "path", imagePath: missingPath },
          targetProjectId: projId,
          proposed: PROPOSED,
          confirmation: PROPOSED,
          attachSourceTo: "parent-task",
          dryRun: false,
        },
        makeCtx(adapter),
      ),
    ).rejects.toThrow(ValidationError);

    // Nothing was written — no orphaned "Captured from image" wrapper.
    expect(await adapter.listTasks({ projectId: projId })).toHaveLength(0);
  });

  it("each-task mode fails before creating any child task when the path is invalid", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const missingPath = join(tmpdir(), `omnifocus-mcp-486-${randomUUID()}.png`);

    await expect(
      handleTaskExtractFromImage(
        {
          source: { kind: "path", imagePath: missingPath },
          targetProjectId: projId,
          proposed: PROPOSED,
          confirmation: PROPOSED,
          attachSourceTo: "each-task",
          dryRun: false,
        },
        makeCtx(adapter),
      ),
    ).rejects.toThrow(ValidationError);

    expect(await adapter.listTasks({ projectId: projId })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Write path — attachSourceTo='parent-task'
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — write phase, parent-task mode", () => {
  it("creates a parent task with the image attached and children under it", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const imagePath = await makeTempImage();
    const ctx = makeCtx(adapter);

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "path", imagePath },
        targetProjectId: projId,
        proposed: PROPOSED,
        confirmation: PROPOSED,
        attachSourceTo: "parent-task",
        parentTaskName: "Whiteboard 2026-04-27",
        dryRun: false,
      },
      ctx,
    );

    expect("data" in env).toBe(true);
    if (!("data" in env)) return;
    expect(env.data.phase).toBe("created");
    if (env.data.phase !== "created") return;

    expect(env.data.parent).toBeDefined();
    expect(env.data.parent?.name).toBe("Whiteboard 2026-04-27");
    expect(env.data.parent?.attachedSourcePath).toBe(imagePath);
    expect(env.data.created).toHaveLength(2);
    expect(env.data.created[0]?.name).toBe("Buy paint");

    // Parent has the attachment
    const parentAttachments = await ctx.attachmentService.list({
      taskId: env.data.parent?.taskId as TaskId,
    });
    expect(parentAttachments).toHaveLength(1);

    // Children are nested under the parent — assert via parentId on each child.
    for (const c of env.data.created) {
      const t = await adapter.getTask(c.taskId);
      expect(t.parentId).toBe(env.data.parent?.taskId);
    }
  });

  it("uses 'Captured from image' as the default parent name", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const imagePath = await makeTempImage();

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "path", imagePath },
        targetProjectId: projId,
        proposed: PROPOSED,
        confirmation: PROPOSED,
        attachSourceTo: "parent-task",
        dryRun: false,
      },
      makeCtx(adapter),
    );

    if (!("data" in env) || env.data.phase !== "created") throw new Error("expected created");
    expect(env.data.parent?.name).toBe("Captured from image");
  });
});

// ---------------------------------------------------------------------------
// Write path — attachSourceTo='each-task'
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — write phase, each-task mode", () => {
  it("attaches the source image to every created task", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const imagePath = await makeTempImage();
    const ctx = makeCtx(adapter);

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "path", imagePath },
        targetProjectId: projId,
        proposed: PROPOSED,
        confirmation: PROPOSED,
        attachSourceTo: "each-task",
        dryRun: false,
      },
      ctx,
    );

    if (!("data" in env) || env.data.phase !== "created") throw new Error("expected created");
    expect(env.data.parent).toBeUndefined();
    expect(env.data.created).toHaveLength(2);

    for (const c of env.data.created) {
      expect(c.attachedSourcePath).toBe(imagePath);
      const atts = await ctx.attachmentService.list({ taskId: c.taskId });
      expect(atts).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Write path — attachSourceTo='none'
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — write phase, none mode", () => {
  it("creates tasks at the project root without any attachment", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const imagePath = await makeTempImage();
    const ctx = makeCtx(adapter);

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "path", imagePath },
        targetProjectId: projId,
        proposed: PROPOSED,
        confirmation: PROPOSED,
        attachSourceTo: "none",
        dryRun: false,
      },
      ctx,
    );

    if (!("data" in env) || env.data.phase !== "created") throw new Error("expected created");
    expect(env.data.created).toHaveLength(2);
    for (const c of env.data.created) {
      expect(c.attachedSourcePath).toBeUndefined();
      const atts = await ctx.attachmentService.list({ taskId: c.taskId });
      expect(atts).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Attachment-mode source
// ---------------------------------------------------------------------------

describe("handleTaskExtractFromImage — attachment-mode source", () => {
  async function seedAttachment(adapter: InMemoryAdapter): Promise<{
    taskId: TaskId;
    attachmentId: AttachmentId;
    projId: ProjectId;
    imagePath: string;
  }> {
    const projId = await adapter.createProject({ name: "Triage" });
    const taskId = await adapter.createTask({ name: "Has image", projectId: projId });
    const imagePath = await makeTempImage(".jpg");
    const attachmentId = await adapter.addAttachment({ taskId, filePath: imagePath });
    return { taskId, attachmentId, projId, imagePath };
  }

  it("validates the attachment is an image (by extension fallback)", async () => {
    const adapter = new InMemoryAdapter();
    const { taskId, attachmentId, projId } = await seedAttachment(adapter);

    const env = await handleTaskExtractFromImage(
      {
        source: { kind: "attachment", attachmentId, ownerTaskId: taskId },
        targetProjectId: projId,
        proposed: PROPOSED,
        attachSourceTo: "none",
        dryRun: true,
      },
      makeCtx(adapter),
    );

    if (!("data" in env)) throw new Error("expected envelope.data");
    expect(env.data.phase).toBe("dryRun");
  });

  it("rejects a non-image attachment", async () => {
    const adapter = new InMemoryAdapter();
    const projId = await adapter.createProject({ name: "Triage" });
    const taskId = await adapter.createTask({ name: "Holder", projectId: projId });
    const txtPath = join(tmpdir(), `omnifocus-mcp-486-${randomUUID()}.txt`);
    await writeFile(txtPath, "nope");
    const attachmentId = await adapter.addAttachment({ taskId, filePath: txtPath });

    await expect(
      handleTaskExtractFromImage(
        {
          source: { kind: "attachment", attachmentId, ownerTaskId: taskId },
          targetProjectId: projId,
          proposed: PROPOSED,
          attachSourceTo: "none",
          dryRun: true,
        },
        makeCtx(adapter),
      ),
    ).rejects.toThrow(/not an image/);
  });

  it("rejects re-attachment requests in v1 (clear scope-cut error)", async () => {
    const adapter = new InMemoryAdapter();
    const { taskId, attachmentId, projId } = await seedAttachment(adapter);

    await expect(
      handleTaskExtractFromImage(
        {
          source: { kind: "attachment", attachmentId, ownerTaskId: taskId },
          targetProjectId: projId,
          proposed: PROPOSED,
          confirmation: PROPOSED,
          attachSourceTo: "parent-task",
          dryRun: false,
        },
        makeCtx(adapter),
      ),
    ).rejects.toMatchObject({
      details: {
        failures: expect.arrayContaining([
          expect.objectContaining({
            expected: expect.stringMatching(
              /attachment-mode source requires attachSourceTo='none'/,
            ),
          }),
        ]),
      },
    });
  });
});
