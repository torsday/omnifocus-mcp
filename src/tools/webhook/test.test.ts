/**
 * Tests for `webhook_test` (slice 4 of #483).
 */

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResponseMeta } from "../../envelope/index.js";
import type { WebhookDispatcher } from "../../webhooks/dispatcher.js";
import type { WebhookEvent } from "../../webhooks/events.js";
import { WebhookOrchestrator } from "../../webhooks/orchestrator.js";
import { WebhookRegistry } from "../../webhooks/registry.js";
import { handleWebhookTest, webhookTestInputSchema } from "./test.js";

class StubDispatcher implements WebhookDispatcher {
  delivered: WebhookEvent[] = [];
  async deliver(event: WebhookEvent): Promise<void> {
    this.delivered.push(event);
  }
}

function tmpFile(): string {
  return path.join(
    tmpdir(),
    `omnifocus-mcp-webhook-test-tool-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`,
  );
}

const makeMeta = (partial: Partial<ResponseMeta> = {}): ResponseMeta => ({
  correlationId: "test",
  durationMs: 1,
  cacheHit: false,
  transport: "memory",
  ofVersion: "test",
  ...partial,
});

describe("webhook_test — schema", () => {
  it("requires name", () => {
    expect(() => webhookTestInputSchema.parse({})).toThrow();
  });
});

describe("webhook_test — handler", () => {
  let filePath: string;
  let registry: WebhookRegistry;
  let dispatcher: StubDispatcher;
  let orchestrator: WebhookOrchestrator;

  beforeEach(() => {
    filePath = tmpFile();
    registry = new WebhookRegistry({ filePath });
    dispatcher = new StubDispatcher();
    orchestrator = new WebhookOrchestrator({ registry, dispatcher });
  });
  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it("rejects when OMNIFOCUS_WEBHOOKS_ENABLED is false", async () => {
    await expect(
      handleWebhookTest({ name: "x" }, { orchestrator, enabled: false, makeMeta }),
    ).rejects.toThrow(/OMNIFOCUS_WEBHOOKS_ENABLED/);
  });

  it("returns delivered:true when the webhook exists and dispatcher accepts", async () => {
    registry.register({
      name: "exists",
      url: "https://example.com/x",
      trigger: { on: "task-completed" },
    });
    const envelope = await handleWebhookTest(
      { name: "exists" },
      { orchestrator, enabled: true, makeMeta },
    );
    if (!("data" in envelope)) throw new Error("expected success");
    expect(envelope.data).toMatchObject({ name: "exists", delivered: true });
    expect(dispatcher.delivered).toHaveLength(1);
  });

  it("returns error when the webhook does not exist (does NOT throw)", async () => {
    const envelope = await handleWebhookTest(
      { name: "missing" },
      { orchestrator, enabled: true, makeMeta },
    );
    if (!("data" in envelope)) throw new Error("expected success");
    const data = envelope.data as { name: string; error?: string; delivered?: true };
    expect(data.error).toContain("not found");
    expect(data.delivered).toBeUndefined();
    expect(dispatcher.delivered).toEqual([]);
  });

  it("dispatched event carries the webhook name verbatim", async () => {
    registry.register({
      name: "trace-by-name",
      url: "https://example.com/x",
      trigger: { on: "task-created" },
    });
    await handleWebhookTest({ name: "trace-by-name" }, { orchestrator, enabled: true, makeMeta });
    expect(dispatcher.delivered[0]?.webhookName).toBe("trace-by-name");
  });

  it("never includes the URL or secret in the response envelope", async () => {
    registry.register({
      name: "leak-test",
      url: "https://internal.example.com/private-path",
      trigger: { on: "task-completed" },
      secret: "supersecret-test-1234",
    });
    const envelope = await handleWebhookTest(
      { name: "leak-test" },
      { orchestrator, enabled: true, makeMeta },
    );
    const json = JSON.stringify(envelope);
    expect(json).not.toContain("internal.example.com");
    expect(json).not.toContain("supersecret-test-1234");
  });
});
