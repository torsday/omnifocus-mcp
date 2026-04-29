/**
 * Webhook registry — JSON-file persistence (per ADR-0016, #483 slice 1).
 *
 * Mirrors the on-disk `webhooks.json` into an in-memory list, exposes
 * mutation methods (`register` / `delete`) that update both the memory and
 * the file atomically, and reads stay in-memory (no I/O on the hot path).
 *
 * **Slice 1 scope: registry only.** Trigger plumbing (cache-refresh diff)
 * lands in slice 2; HTTP delivery + retry + circuit breaker land in slice 3;
 * `webhook_test` synthetic-event tool + integration test land in slice 4.
 *
 * On-disk layout:
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "webhooks": [
 *     { "name": "...", "url": "https://...", "trigger": {...}, "secret"?: "...", "createdAt": "..." }
 *   ]
 * }
 * ```
 *
 * Filesystem invariants:
 * - File mode `0600` (read/write owner only). Enforced on write.
 * - Parent directory created if missing, with mode `0700`.
 * - Atomic writes via `<file>.tmp` + `rename` so a crash mid-write never
 *   corrupts the registry.
 *
 * @see docs/adr/0016-webhook-delivery.md
 * @see src/webhooks/types.ts — wire-format types
 */

import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ValidationError } from "../errors/index.js";
import type { Webhook, WebhookSummary } from "./types.js";
import { summarizeWebhook } from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Default registry-file path on macOS. The npm package's `os` field is
 * `darwin`, so this is the only platform that runs at runtime; the path is
 * still injectable for tests.
 */
export function defaultRegistryPath(): string {
  return path.join(homedir(), "Library", "Application Support", "omnifocus-mcp", "webhooks.json");
}

// ---------------------------------------------------------------------------
// File schema
// ---------------------------------------------------------------------------

interface OnDiskRegistry {
  version: 1;
  webhooks: Webhook[];
}

const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface WebhookRegistryOptions {
  /** Override the registry-file path. Defaults to `defaultRegistryPath()`. */
  filePath?: string;
}

export class WebhookRegistry {
  private readonly filePath: string;
  private webhooks: Webhook[] = [];

  constructor(options: WebhookRegistryOptions = {}) {
    this.filePath = options.filePath ?? defaultRegistryPath();
    this.load();
  }

  /** Absolute path to the on-disk registry file. */
  path(): string {
    return this.filePath;
  }

  /**
   * Internal-only list including URLs and secrets. Used by the orchestrator
   * for dispatch lookups. **MUST NOT** be exposed through any tool, resource,
   * or log line — see ADR-0016 §4d. The public `list()` method returns the
   * sanitized `WebhookSummary` form for tools and the capability resource.
   */
  listFull(): readonly Webhook[] {
    return this.webhooks;
  }

  /** Public-facing list — never includes URLs or secrets. */
  list(): WebhookSummary[] {
    return this.webhooks.map(summarizeWebhook);
  }

  /** True when a webhook with this name exists. */
  has(name: string): boolean {
    return this.webhooks.some((w) => w.name === name);
  }

  /**
   * Register a new webhook. Throws `ValidationError` when the name is
   * already taken — names are the stable lookup key.
   */
  register(input: Omit<Webhook, "createdAt">): WebhookSummary {
    if (this.has(input.name)) {
      throw new ValidationError(`webhook name already registered: ${input.name}`, {
        details: { field: "name", value: input.name },
      });
    }
    const entry: Webhook = {
      name: input.name,
      url: input.url,
      trigger: input.trigger,
      ...(input.secret !== undefined && { secret: input.secret }),
      createdAt: new Date().toISOString(),
    };
    this.webhooks = [...this.webhooks, entry];
    this.persist();
    return summarizeWebhook(entry);
  }

  /**
   * Remove a webhook by name. Returns `true` when something was removed,
   * `false` when no webhook by that name was registered (idempotent caller).
   */
  delete(name: string): boolean {
    const before = this.webhooks.length;
    this.webhooks = this.webhooks.filter((w) => w.name !== name);
    const removed = this.webhooks.length !== before;
    if (removed) this.persist();
    return removed;
  }

  // -- Internals -----------------------------------------------------------

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.webhooks = [];
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as OnDiskRegistry;
      if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.webhooks)) {
        // Corrupt or future-version file. Treat as empty rather than throwing —
        // the user's reads must not break. Operator can inspect / repair.
        this.webhooks = [];
        return;
      }
      this.webhooks = parsed.webhooks;
    } catch {
      // Malformed JSON, permission error — degrade to empty registry.
      this.webhooks = [];
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const payload: OnDiskRegistry = { version: SCHEMA_VERSION, webhooks: this.webhooks };
    const json = JSON.stringify(payload, null, 2);
    // Atomic write via tmp + rename so a crash mid-write never corrupts.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, json, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    // Defensive chmod — `writeFileSync(mode)` only applies when creating;
    // an existing file keeps its prior mode through `rename`.
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // chmod can fail on some filesystems; the rename already succeeded so
      // the registry is functionally correct even if mode is looser.
    }
  }
}
