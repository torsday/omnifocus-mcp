/**
 * Webhook subsystem domain types (per ADR-0016, #483 slice 1).
 *
 * Wire-format types for outbound HTTP webhook delivery on OmniFocus state
 * changes. Kept separate from the registry implementation so the tool layer
 * can reference the shapes without pulling in fs / file-watch concerns.
 *
 * @see docs/adr/0016-webhook-delivery.md
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * Discriminated union of webhook triggers. Each variant names an OmniFocus
 * state change the subsystem can detect at cache-refresh diff time, plus an
 * optional filter that narrows the firing set.
 */
export type WebhookTrigger =
  | { on: "task-completed"; filter?: { tagId?: string; projectId?: string } }
  | { on: "task-created"; filter?: { tagId?: string; projectId?: string } }
  | { on: "project-status-changed"; filter?: { projectId?: string } };

const triggerFilterTaskSchema = z
  .object({
    tagId: z.string().min(1).optional().describe("Restrict to tasks carrying this tag."),
    projectId: z.string().min(1).optional().describe("Restrict to tasks in this project."),
  })
  .optional()
  .describe("Optional filter narrowing which task events fire this webhook.");

const triggerFilterProjectSchema = z
  .object({
    projectId: z.string().min(1).optional().describe("Restrict to status changes on this project."),
  })
  .optional()
  .describe("Optional filter narrowing which project events fire this webhook.");

export const webhookTriggerSchema: z.ZodType<WebhookTrigger> = z.discriminatedUnion("on", [
  z.object({ on: z.literal("task-completed"), filter: triggerFilterTaskSchema }),
  z.object({ on: z.literal("task-created"), filter: triggerFilterTaskSchema }),
  z.object({ on: z.literal("project-status-changed"), filter: triggerFilterProjectSchema }),
]) as z.ZodType<WebhookTrigger>;

// ---------------------------------------------------------------------------
// Webhook record
// ---------------------------------------------------------------------------

/**
 * One registered webhook. The `secret` is on-disk only — never echoed back
 * through any tool response, never logged, never surfaced to the capability
 * resource. The tool surface returns `WebhookSummary` which omits both the
 * secret and the URL (per ADR-0016 §4d).
 */
export interface Webhook {
  /** User-supplied stable name. Unique within the registry. */
  name: string;
  /** Outbound URL — HTTPS only, validated at registration. */
  url: string;
  /** Trigger discriminator + optional filter. */
  trigger: WebhookTrigger;
  /** Optional HMAC secret. When set, every delivery includes an X-OmniFocus-Signature header. */
  secret?: string;
  /** ISO-8601 timestamp set automatically on registration. */
  createdAt: string;
}

/**
 * Public-facing view of a webhook — what tool callers and the capability
 * resource see. URL and secret are NEVER included.
 */
export interface WebhookSummary {
  name: string;
  trigger: WebhookTrigger;
  /** True when the registration carried a secret. The secret itself is never returned. */
  secretSet: boolean;
  createdAt: string;
}

export function summarizeWebhook(w: Webhook): WebhookSummary {
  return {
    name: w.name,
    trigger: w.trigger,
    secretSet: w.secret !== undefined && w.secret.length > 0,
    createdAt: w.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Webhook-name validation: non-empty, ≤ 64 chars, no whitespace. */
export const webhookNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^\S+$/, "must not contain whitespace")
  .describe("Stable name for the webhook. Unique within the registry; used as the lookup key.");

/** URL validation — HTTPS only per ADR-0016 §4b. */
export const webhookUrlSchema = z
  .string()
  .min(1)
  .refine((v) => v.startsWith("https://"), {
    message: "url must use https:// (http:// rejected per ADR-0016 §4b)",
  })
  .describe("Outbound HTTPS URL. http:// is rejected.");

/** Optional HMAC secret — non-empty when present. */
export const webhookSecretSchema = z
  .string()
  .min(8, "secret must be at least 8 characters when supplied")
  .max(256)
  .optional()
  .describe(
    "Optional HMAC seed for signature header. Stored on disk only; never echoed back. " +
      "Receivers verify via X-OmniFocus-Signature: sha256=<hex> using the same secret.",
  );
