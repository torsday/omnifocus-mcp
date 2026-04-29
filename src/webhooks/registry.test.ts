/**
 * Tests for the webhook registry — file persistence, mode 0600, atomic
 * writes, idempotent delete, and graceful degradation on a corrupt file.
 */

import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebhookRegistry } from "./registry.js";
import type { WebhookTrigger } from "./types.js";

const TASK_COMPLETED: WebhookTrigger = { on: "task-completed" };

function tmpFile(): string {
  return path.join(
    tmpdir(),
    `omnifocus-mcp-webhooks-test-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.json`,
  );
}

describe("WebhookRegistry", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });

  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const dir = path.dirname(filePath);
    if (dir.includes("omnifocus-mcp-webhooks-test-")) {
      try {
        fs.rmdirSync(dir);
      } catch {
        /* dir may not be empty if the test created sibling files */
      }
    }
  });

  it("starts empty when no file exists", () => {
    const reg = new WebhookRegistry({ filePath });
    expect(reg.list()).toEqual([]);
  });

  it("registers a new webhook and persists to disk", () => {
    const reg = new WebhookRegistry({ filePath });
    const summary = reg.register({
      name: "slack-billing",
      url: "https://hooks.slack.com/services/x",
      trigger: TASK_COMPLETED,
    });
    expect(summary).toMatchObject({
      name: "slack-billing",
      secretSet: false,
      trigger: TASK_COMPLETED,
    });
    expect(summary).toHaveProperty("createdAt");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("on-disk file is mode 0600", () => {
    const reg = new WebhookRegistry({ filePath });
    reg.register({
      name: "mode-check",
      url: "https://example.com/hook",
      trigger: TASK_COMPLETED,
    });
    const stat = fs.statSync(filePath);
    // Mask out anything above the 9 permission bits.
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("persisted file is parseable and round-trips through a fresh registry", () => {
    const r1 = new WebhookRegistry({ filePath });
    r1.register({
      name: "trip",
      url: "https://example.com/x",
      trigger: TASK_COMPLETED,
      secret: "supersecret",
    });
    const r2 = new WebhookRegistry({ filePath });
    expect(r2.list()).toHaveLength(1);
    const [first] = r2.list();
    expect(first?.name).toBe("trip");
    expect(first?.secretSet).toBe(true);
  });

  it("list() never includes the URL or secret in the public summary", () => {
    const reg = new WebhookRegistry({ filePath });
    reg.register({
      name: "hide-url",
      url: "https://supersecret.example.com/very-private",
      trigger: TASK_COMPLETED,
      secret: "super-secret-value",
    });
    const json = JSON.stringify(reg.list());
    expect(json).not.toContain("supersecret.example.com");
    expect(json).not.toContain("super-secret-value");
  });

  it("rejects duplicate names with ValidationError", () => {
    const reg = new WebhookRegistry({ filePath });
    reg.register({ name: "dup", url: "https://example.com/a", trigger: TASK_COMPLETED });
    expect(() =>
      reg.register({ name: "dup", url: "https://example.com/b", trigger: TASK_COMPLETED }),
    ).toThrow(/already registered/i);
  });

  it("delete returns true for existing, false for missing (idempotent)", () => {
    const reg = new WebhookRegistry({ filePath });
    reg.register({ name: "x", url: "https://example.com/x", trigger: TASK_COMPLETED });
    expect(reg.delete("x")).toBe(true);
    expect(reg.delete("x")).toBe(false);
    expect(reg.list()).toEqual([]);
  });

  it("delete persists the change", () => {
    const r1 = new WebhookRegistry({ filePath });
    r1.register({ name: "ephemeral", url: "https://example.com/x", trigger: TASK_COMPLETED });
    r1.delete("ephemeral");
    const r2 = new WebhookRegistry({ filePath });
    expect(r2.list()).toEqual([]);
  });

  it("creates the parent directory if it does not exist", () => {
    const nestedFile = path.join(
      tmpdir(),
      `omnifocus-mcp-webhooks-test-${Date.now()}`,
      "nested",
      "webhooks.json",
    );
    try {
      const reg = new WebhookRegistry({ filePath: nestedFile });
      reg.register({ name: "nested", url: "https://example.com/x", trigger: TASK_COMPLETED });
      expect(fs.existsSync(nestedFile)).toBe(true);
    } finally {
      if (fs.existsSync(nestedFile)) fs.unlinkSync(nestedFile);
      try {
        fs.rmdirSync(path.dirname(nestedFile));
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(path.dirname(path.dirname(nestedFile)));
      } catch {
        /* ignore */
      }
    }
  });

  it("degrades to empty list when on-disk file is malformed JSON", () => {
    fs.writeFileSync(filePath, "not-json", { mode: 0o600 });
    const reg = new WebhookRegistry({ filePath });
    expect(reg.list()).toEqual([]);
  });

  it("degrades to empty list when on-disk schema version is unrecognised", () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 999, webhooks: [] }), { mode: 0o600 });
    const reg = new WebhookRegistry({ filePath });
    expect(reg.list()).toEqual([]);
  });

  it("multiple webhooks are listed in registration order", () => {
    const reg = new WebhookRegistry({ filePath });
    reg.register({ name: "a", url: "https://example.com/a", trigger: TASK_COMPLETED });
    reg.register({ name: "b", url: "https://example.com/b", trigger: TASK_COMPLETED });
    reg.register({ name: "c", url: "https://example.com/c", trigger: TASK_COMPLETED });
    expect(reg.list().map((s) => s.name)).toEqual(["a", "b", "c"]);
  });
});
