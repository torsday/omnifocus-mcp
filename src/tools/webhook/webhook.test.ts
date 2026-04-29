/**
 * Tests for webhook_register / webhook_list / webhook_delete (slice 1 of #483).
 *
 * Covers env-gating, schema validation (HTTPS-only, name shape, secret bounds),
 * end-to-end register → list → delete round-trips, and the public-summary
 * contract (URL + secret never returned).
 */

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResponseMeta } from "../../envelope/index.js";
import { WebhookRegistry } from "../../webhooks/registry.js";
import { handleWebhookDelete, webhookDeleteInputSchema } from "./delete.js";
import { handleWebhookList } from "./list.js";
import {
  handleWebhookRegister,
  type WebhookContext,
  webhookRegisterInputSchema,
} from "./register.js";

function tmpFile(): string {
  return path.join(
    tmpdir(),
    `omnifocus-mcp-webhook-tool-test-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`,
  );
}

const TASK_COMPLETED = { on: "task-completed" } as const;

function makeMeta(partial: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    correlationId: "test",
    durationMs: 1,
    cacheHit: false,
    transport: "memory",
    ofVersion: "test",
    ...partial,
  };
}

describe("webhook tools — env gating", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("webhook_register throws ValidationError when OMNIFOCUS_WEBHOOKS_ENABLED is unset", async () => {
    const ctx: WebhookContext = {
      registry: new WebhookRegistry({ filePath }),
      enabled: false,
      makeMeta,
    };
    await expect(
      handleWebhookRegister(
        { name: "x", url: "https://example.com/x", trigger: TASK_COMPLETED },
        ctx,
      ),
    ).rejects.toThrow(/OMNIFOCUS_WEBHOOKS_ENABLED/);
  });

  it("webhook_list throws ValidationError when disabled", async () => {
    const ctx: WebhookContext = {
      registry: new WebhookRegistry({ filePath }),
      enabled: false,
      makeMeta,
    };
    await expect(handleWebhookList({}, ctx)).rejects.toThrow(/OMNIFOCUS_WEBHOOKS_ENABLED/);
  });

  it("webhook_delete throws ValidationError when disabled", async () => {
    const ctx: WebhookContext = {
      registry: new WebhookRegistry({ filePath }),
      enabled: false,
      makeMeta,
    };
    await expect(handleWebhookDelete({ name: "x" }, ctx)).rejects.toThrow(
      /OMNIFOCUS_WEBHOOKS_ENABLED/,
    );
  });
});

describe("webhook_register — schema validation", () => {
  it("rejects http:// URLs", () => {
    expect(() =>
      webhookRegisterInputSchema.parse({
        name: "n",
        url: "http://example.com/x",
        trigger: TASK_COMPLETED,
      }),
    ).toThrow(/https/);
  });

  it("accepts https:// URLs", () => {
    expect(() =>
      webhookRegisterInputSchema.parse({
        name: "n",
        url: "https://example.com/x",
        trigger: TASK_COMPLETED,
      }),
    ).not.toThrow();
  });

  it("rejects names with whitespace", () => {
    expect(() =>
      webhookRegisterInputSchema.parse({
        name: "has space",
        url: "https://example.com/x",
        trigger: TASK_COMPLETED,
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      webhookRegisterInputSchema.parse({
        name: "",
        url: "https://example.com/x",
        trigger: TASK_COMPLETED,
      }),
    ).toThrow();
  });

  it("rejects too-short secrets (<8 chars)", () => {
    expect(() =>
      webhookRegisterInputSchema.parse({
        name: "n",
        url: "https://example.com/x",
        trigger: TASK_COMPLETED,
        secret: "short",
      }),
    ).toThrow();
  });

  it("accepts every trigger variant", () => {
    const triggers = [
      { on: "task-completed", filter: { tagId: "t1" } },
      { on: "task-completed", filter: { projectId: "p1" } },
      { on: "task-created" },
      { on: "project-status-changed", filter: { projectId: "p1" } },
    ];
    for (const trigger of triggers) {
      expect(() =>
        webhookRegisterInputSchema.parse({ name: "n", url: "https://x.com/y", trigger }),
      ).not.toThrow();
    }
  });
});

describe("webhook_delete — schema validation", () => {
  it("requires a name", () => {
    expect(() => webhookDeleteInputSchema.parse({})).toThrow();
  });
});

describe("webhook tools — end-to-end (enabled)", () => {
  let filePath: string;
  let ctx: WebhookContext;

  beforeEach(() => {
    filePath = tmpFile();
    ctx = {
      registry: new WebhookRegistry({ filePath }),
      enabled: true,
      makeMeta,
    };
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("register → list shows the new entry", async () => {
    const reg = await handleWebhookRegister(
      { name: "first", url: "https://example.com/first", trigger: TASK_COMPLETED },
      ctx,
    );
    if (!("data" in reg)) throw new Error("expected success");
    expect(reg.data.webhook.name).toBe("first");

    const lst = await handleWebhookList({}, ctx);
    if (!("data" in lst)) throw new Error("expected success");
    expect(lst.data.webhooks).toHaveLength(1);
    expect(lst.data.webhooks[0]?.name).toBe("first");
  });

  it("list response never includes the URL or secret", async () => {
    await handleWebhookRegister(
      {
        name: "secret-bearer",
        url: "https://internal-host.example.com/very-private-path",
        trigger: TASK_COMPLETED,
        secret: "super-secret-12345",
      },
      ctx,
    );
    const envelope = await handleWebhookList({}, ctx);
    const json = JSON.stringify(envelope);
    expect(json).not.toContain("internal-host.example.com");
    expect(json).not.toContain("super-secret-12345");
    if (!("data" in envelope)) throw new Error("expected success");
    expect(envelope.data.webhooks[0]?.secretSet).toBe(true);
  });

  it("delete removes the entry; second delete is noChange", async () => {
    await handleWebhookRegister(
      { name: "doomed", url: "https://example.com/x", trigger: TASK_COMPLETED },
      ctx,
    );
    const first = await handleWebhookDelete({ name: "doomed" }, ctx);
    const second = await handleWebhookDelete({ name: "doomed" }, ctx);
    if (!("data" in first) || !("data" in second)) throw new Error("expected success");
    expect(first.data).toMatchObject({ deleted: true });
    expect(second.data).toMatchObject({ noChange: true });
  });

  it("registering a duplicate name throws ValidationError", async () => {
    await handleWebhookRegister(
      { name: "dup", url: "https://example.com/a", trigger: TASK_COMPLETED },
      ctx,
    );
    await expect(
      handleWebhookRegister(
        { name: "dup", url: "https://example.com/b", trigger: TASK_COMPLETED },
        ctx,
      ),
    ).rejects.toThrow(/already registered/i);
  });

  it("createdAt is set automatically and is a valid ISO-8601 timestamp", async () => {
    const before = Date.now();
    const envelope = await handleWebhookRegister(
      { name: "t", url: "https://example.com/x", trigger: TASK_COMPLETED },
      ctx,
    );
    const after = Date.now();
    if (!("data" in envelope)) throw new Error("expected success");
    const createdAt = new Date(envelope.data.webhook.createdAt).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });
});
