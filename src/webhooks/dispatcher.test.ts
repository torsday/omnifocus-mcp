/**
 * Tests for the StderrLoggingDispatcher stub (slice 2 of #483).
 */

import { describe, expect, it } from "vitest";
import { StderrLoggingDispatcher } from "./dispatcher.js";
import type { WebhookEvent } from "./events.js";
import type { Webhook } from "./types.js";

const sampleWebhook: Webhook = {
  name: "slack-billing",
  url: "https://hooks.slack.com/services/sensitive-path",
  trigger: { on: "task-completed" },
  secret: "super-secret-12345",
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleEvent: WebhookEvent = {
  kind: "task-completed",
  webhookName: "slack-billing",
  taskId: "t1",
  taskName: "test",
  projectId: "p1",
  tagIds: [],
  occurredAt: "2026-04-29T18:00:00Z",
};

describe("StderrLoggingDispatcher", () => {
  it("logs a stub line when the webhook is found", async () => {
    const writes: string[] = [];
    const dispatcher = new StderrLoggingDispatcher({ write: (line) => writes.push(line) });
    await dispatcher.deliver(sampleEvent, () => sampleWebhook);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("task-completed");
    expect(writes[0]).toContain("slack-billing");
  });

  it("never includes the URL or secret in the log line (per ADR-0016 §4d)", async () => {
    const writes: string[] = [];
    const dispatcher = new StderrLoggingDispatcher({ write: (line) => writes.push(line) });
    await dispatcher.deliver(sampleEvent, () => sampleWebhook);
    const joined = writes.join("\n");
    expect(joined).not.toContain("hooks.slack.com");
    expect(joined).not.toContain("sensitive-path");
    expect(joined).not.toContain("super-secret-12345");
  });

  it("logs and drops when the webhook lookup returns undefined", async () => {
    const writes: string[] = [];
    const dispatcher = new StderrLoggingDispatcher({ write: (line) => writes.push(line) });
    await dispatcher.deliver(sampleEvent, () => undefined);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("not found");
    expect(writes[0]).toContain("slack-billing");
  });

  it("default writer is process.stderr.write (smoke check on construction)", () => {
    // Construction should not throw with no options.
    const dispatcher = new StderrLoggingDispatcher();
    expect(dispatcher).toBeInstanceOf(StderrLoggingDispatcher);
  });
});
