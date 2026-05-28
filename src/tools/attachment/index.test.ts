/**
 * Unit tests for attachment tools.
 *
 * Uses InMemoryAdapter so no live OmniFocus process is needed.
 * `assertAttachmentPath` calls `realpath()` so tests that exercise `add()` or
 * `saveTo()` must create real temp files before calling those operations.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { InMemoryAdapter } from "../../adapter/inMemory/InMemoryAdapter.js";
import type { ResponseMeta } from "../../envelope/index.js";
import { AttachmentService } from "../../services/attachmentService.js";
import type { AttachmentToolContext } from "./index.js";
import {
  handleAttachmentCreate as handleAttachmentAdd,
  handleAttachmentList,
  handleAttachmentDelete as handleAttachmentRemove,
  handleAttachmentSaveToPath,
  registerAttachmentTools,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(adapter: InMemoryAdapter): AttachmentToolContext {
  const svc = new AttachmentService({
    adapter,
    allowedPaths: [tmpdir(), "/private/var/folders", "/var/folders"],
    maxAttachmentMb: 100,
  });
  const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
    correlationId: "test-001",
    durationMs: 0,
    cacheHit: false,
    transport: "memory",
    ofVersion: "unknown",
    ...partial,
  });
  return { attachmentService: svc, makeMeta };
}

async function seedTask(adapter: InMemoryAdapter) {
  return adapter.createTask({ name: "Test task" });
}

async function seedProject(adapter: InMemoryAdapter) {
  return adapter.createProject({ name: "Test project" });
}

/** Create a real temp file at the given path so realpath() resolves it. */
async function touchFile(p: string): Promise<string> {
  await writeFile(p, "test content");
  return p;
}

function tmpFile(name?: string): string {
  return join(tmpdir(), name ?? `omnifocus-mcp-test-${randomUUID()}.txt`);
}

// ---------------------------------------------------------------------------
// attachment_list
// ---------------------------------------------------------------------------

describe("handleAttachmentList", () => {
  it("returns empty array when task has no attachments", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);

    const result = await handleAttachmentList({ taskId }, ctx);
    expect(result.data.attachments).toEqual([]);
  });

  it("returns empty array when project has no attachments", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await seedProject(adapter);
    const ctx = makeCtx(adapter);

    const result = await handleAttachmentList({ projectId }, ctx);
    expect(result.data.attachments).toEqual([]);
  });

  it("returns attachments after they are added", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile("fake.txt"));

    await handleAttachmentAdd({ taskId, filePath }, ctx);
    const result = await handleAttachmentList({ taskId }, ctx);

    expect(result.data.attachments).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(result.data.attachments[0]!.name).toBe("fake.txt");
  });

  it("throws NotFound for unknown task", async () => {
    const adapter = new InMemoryAdapter();
    const ctx = makeCtx(adapter);

    await expect(handleAttachmentList({ taskId: "task_999999" as never }, ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// attachment_add
// ---------------------------------------------------------------------------

describe("handleAttachmentAdd", () => {
  it("returns a new attachment ID for a task", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const result = await handleAttachmentAdd({ taskId, filePath }, ctx);
    expect(result.data.id).toBeTruthy();
    expect(typeof result.data.id).toBe("string");
  });

  it("returns a new attachment ID for a project", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await seedProject(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const result = await handleAttachmentAdd({ projectId, filePath }, ctx);
    expect(result.data.id).toBeTruthy();
  });

  it("increments count on subsequent adds", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const [a, b] = await Promise.all([touchFile(tmpFile()), touchFile(tmpFile())]);

    await handleAttachmentAdd({ taskId, filePath: a }, ctx);
    await handleAttachmentAdd({ taskId, filePath: b }, ctx);

    const list = await handleAttachmentList({ taskId }, ctx);
    expect(list.data.attachments).toHaveLength(2);
  });

  it("throws NotFound for unknown task", async () => {
    const adapter = new InMemoryAdapter();
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    await expect(
      handleAttachmentAdd({ taskId: "task_999999" as never, filePath }, ctx),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// attachment_remove
// ---------------------------------------------------------------------------

describe("handleAttachmentRemove", () => {
  it("removes an attachment from a task", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const addResult = await handleAttachmentAdd({ taskId, filePath }, ctx);
    const attachmentId = addResult.data.id;

    await handleAttachmentRemove({ taskId, attachmentId }, ctx);

    const list = await handleAttachmentList({ taskId }, ctx);
    expect(list.data.attachments).toHaveLength(0);
  });

  it("throws NotFound when attachmentId does not exist", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);

    await expect(
      handleAttachmentRemove({ taskId, attachmentId: "att_999999" as never }, ctx),
    ).rejects.toThrow();
  });

  it("returns { removed: true } on success", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const {
      data: { id: attachmentId },
    } = await handleAttachmentAdd({ taskId, filePath }, ctx);
    const result = await handleAttachmentRemove({ taskId, attachmentId }, ctx);
    expect(result.data.removed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// name pairing (#601)
// ---------------------------------------------------------------------------

describe("attachment_add pairs ownerKind/ownerName with id (#601)", () => {
  it("returns task name on add to task", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const result = await handleAttachmentAdd({ taskId, filePath }, ctx);
    expect(result.data.ownerKind).toBe("task");
    expect(result.data.ownerName).toBe("Test task");
  });

  it("returns project name on add to project", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await seedProject(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const result = await handleAttachmentAdd({ projectId, filePath }, ctx);
    expect(result.data.ownerKind).toBe("project");
    expect(result.data.ownerName).toBe("Test project");
  });
});

describe("attachment_remove pairs ownerKind/ownerName with id (#601)", () => {
  it("returns task name on remove from task", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const {
      data: { id: attachmentId },
    } = await handleAttachmentAdd({ taskId, filePath }, ctx);
    const result = await handleAttachmentRemove({ taskId, attachmentId }, ctx);
    expect(result.data.removed).toBe(true);
    expect(result.data.attachmentId).toBe(attachmentId);
    expect(result.data.ownerKind).toBe("task");
    expect(result.data.ownerName).toBe("Test task");
  });

  it("returns project name on remove from project", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await seedProject(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const {
      data: { id: attachmentId },
    } = await handleAttachmentAdd({ projectId, filePath }, ctx);
    const result = await handleAttachmentRemove({ projectId, attachmentId }, ctx);
    expect(result.data.ownerKind).toBe("project");
    expect(result.data.ownerName).toBe("Test project");
  });
});

// ---------------------------------------------------------------------------
// attachment_save_to_path
// ---------------------------------------------------------------------------

describe("handleAttachmentSaveToPath", () => {
  it("returns { saved: true, path, sizeBytes } for in-memory adapter", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const {
      data: { id: attachmentId },
    } = await handleAttachmentAdd({ taskId, filePath }, ctx);

    const destPath = tmpFile();
    const result = await handleAttachmentSaveToPath({ taskId, attachmentId, destPath }, ctx);

    expect(result.data.saved).toBe(true);
    expect(result.data.path).toBe(destPath);
    expect(typeof result.data.sizeBytes).toBe("number");
  });

  it("throws NotFound when attachment does not exist", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);

    await expect(
      handleAttachmentSaveToPath(
        {
          taskId,
          attachmentId: "att_999999" as never,
          destPath: tmpFile(),
        },
        ctx,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// schema — owner validation
// ---------------------------------------------------------------------------

describe("owner validation via resolveOwner", () => {
  it("accepts taskId only", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    await expect(handleAttachmentList({ taskId }, ctx)).resolves.toBeDefined();
  });

  it("accepts projectId only", async () => {
    const adapter = new InMemoryAdapter();
    const projectId = await seedProject(adapter);
    const ctx = makeCtx(adapter);
    await expect(handleAttachmentList({ projectId }, ctx)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// deprecated aliases — attachment_add / attachment_remove (#1051)
// ---------------------------------------------------------------------------

describe("registerAttachmentTools — deprecated aliases (#1051)", () => {
  /** Minimal server stub that captures registered tool handlers by name. */
  function captureRegistrations(ctx: AttachmentToolContext) {
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>();
    const server = {
      registerTool: (name: string, _cfg: unknown, handler: (args: unknown) => Promise<unknown>) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    registerAttachmentTools(server, ctx);
    return handlers;
  }

  it("registers canonical names and the deprecated aliases", () => {
    const handlers = captureRegistrations(makeCtx(new InMemoryAdapter()));
    for (const name of [
      "attachment_create",
      "attachment_delete",
      "attachment_add",
      "attachment_remove",
      "attachment_list",
      "attachment_save_to_path",
    ]) {
      expect(handlers.has(name), `expected ${name} to be registered`).toBe(true);
    }
  });

  it("attachment_add alias delegates to the create handler", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());

    const handlers = captureRegistrations(ctx);
    const aliasHandler = handlers.get("attachment_add");
    expect(aliasHandler).toBeDefined();

    const res = (await aliasHandler?.({ taskId, filePath })) as {
      structuredContent: { data: { id: string; ownerKind: string } };
    };
    expect(res.structuredContent.data.id).toBeTruthy();
    expect(res.structuredContent.data.ownerKind).toBe("task");
  });

  it("attachment_remove alias delegates to the delete handler", async () => {
    const adapter = new InMemoryAdapter();
    const taskId = await seedTask(adapter);
    const ctx = makeCtx(adapter);
    const filePath = await touchFile(tmpFile());
    const {
      data: { id: attachmentId },
    } = await handleAttachmentAdd({ taskId, filePath }, ctx);

    const handlers = captureRegistrations(ctx);
    const aliasHandler = handlers.get("attachment_remove");
    const res = (await aliasHandler?.({ taskId, attachmentId })) as {
      structuredContent: { data: { removed: boolean } };
    };
    expect(res.structuredContent.data.removed).toBe(true);
  });
});
