/**
 * `webhook_register` MCP tool — register an outbound webhook (per ADR-0016, #483 slice 1).
 *
 * **Slice 1 scope.** This tool wires an entry into the registry and persists
 * it on disk. Actual delivery happens in slice 3; the trigger plumbing lands
 * in slice 2; the synthetic-event `webhook_test` tool lands in slice 4.
 *
 * Gating: when `OMNIFOCUS_WEBHOOKS_ENABLED` is unset, this tool returns a
 * `ValidationError` rather than silently registering — the user must opt in
 * explicitly via env, mirroring the `OMNIFOCUS_ALLOW_RAW_SCRIPT` pattern
 * (ADR-0004).
 *
 * @see docs/adr/0016-webhook-delivery.md
 * @see src/webhooks/registry.ts
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import type { WebhookRegistry } from "../../webhooks/registry.js";
import {
  type WebhookSummary,
  type WebhookTrigger,
  webhookNameSchema,
  webhookSecretSchema,
  webhookTriggerSchema,
  webhookUrlSchema,
} from "../../webhooks/types.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const WEBHOOK_REGISTER_DESCRIPTION =
  "Register an outbound webhook that fires when an OmniFocus state change matches the supplied trigger. " +
  "Off by default — requires OMNIFOCUS_WEBHOOKS_ENABLED=1 in the environment, mirroring the raw-script gating. " +
  "URLs must use https:// (http:// is rejected at registration). " +
  "An optional secret enables HMAC-SHA256 signature verification by the receiver via X-OmniFocus-Signature: sha256=<hex>; " +
  "the secret is stored on disk only and is never echoed back through any tool response. " +
  "Do NOT use this to call this MCP server itself — webhooks are outbound only. " +
  "Returns { webhook: WebhookSummary } where the summary omits both URL and secret. " +
  "Side effects: writes to the registry config file at ~/Library/Application Support/omnifocus-mcp/webhooks.json " +
  "(mode 0600). " +
  'Example: webhook_register({ name: "slack-billing", url: "https://hooks.slack.com/services/...", trigger: { on: "task-completed", filter: { tagId: "tag_xyz" } } })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const webhookRegisterInputSchema = z.object({
  name: webhookNameSchema.describe(
    "Stable name for the webhook. Unique within the registry; used as the lookup key. " +
      "≤64 chars, no whitespace.",
  ),
  url: webhookUrlSchema.describe(
    "Outbound HTTPS URL. http:// is rejected at registration (per ADR-0016 §4b).",
  ),
  trigger: webhookTriggerSchema.describe(
    "What triggers a webhook fire — one of task-completed, task-created, or project-status-changed. " +
      "Each variant accepts an optional filter narrowing which entities count.",
  ),
  secret: webhookSecretSchema.describe(
    "Optional HMAC seed (8–256 chars). When set, every delivery includes an X-OmniFocus-Signature: " +
      "sha256=<hex> header so the receiver can verify authenticity. Stored on disk only; never echoed.",
  ),
});

export type WebhookRegisterInput = z.infer<typeof webhookRegisterInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface WebhookContext {
  registry: WebhookRegistry;
  /** True when `OMNIFOCUS_WEBHOOKS_ENABLED=1`. When false, every tool returns ValidationError. */
  enabled: boolean;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export function assertEnabled(ctx: WebhookContext): void {
  if (!ctx.enabled) {
    throw new ValidationError(
      "Webhook subsystem is disabled. Set OMNIFOCUS_WEBHOOKS_ENABLED=1 in the environment to enable.",
      { details: { field: "OMNIFOCUS_WEBHOOKS_ENABLED" } },
    );
  }
}

export async function handleWebhookRegister(input: WebhookRegisterInput, ctx: WebhookContext) {
  assertEnabled(ctx);
  const summary: WebhookSummary = ctx.registry.register({
    name: input.name,
    url: input.url,
    trigger: input.trigger as WebhookTrigger,
    ...(input.secret !== undefined && { secret: input.secret }),
  });
  return ok({ webhook: summary }, ctx.makeMeta());
}

export function registerWebhookRegisterTool(server: McpServer, ctx: WebhookContext) {
  return server.registerTool(
    "webhook_register",
    {
      description: WEBHOOK_REGISTER_DESCRIPTION,
      inputSchema: webhookRegisterInputSchema.shape,
    },
    async (args: WebhookRegisterInput) => {
      const envelope = await handleWebhookRegister(args, ctx);
      return toolResponse(envelope);
    },
  );
}
