/**
 * `webhook_test` MCP tool — fire a synthetic event through a registered webhook
 * (per ADR-0016, #483 slice 4).
 *
 * Lets the user verify a webhook is wired correctly without waiting for an
 * actual state change. Goes through the same `HttpsDispatcher` path as a
 * real delivery: HTTPS POST, HMAC signature when secret set, retries,
 * circuit breaker.
 *
 * Off by default — requires `OMNIFOCUS_WEBHOOKS_ENABLED=1`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import { ValidationError } from "../../errors/index.js";
import type { WebhookOrchestrator } from "../../webhooks/orchestrator.js";
import { webhookNameSchema } from "../../webhooks/types.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const WEBHOOK_TEST_DESCRIPTION =
  "Fire a synthetic event through a registered webhook to verify it's wired correctly. " +
  "Goes through the same HTTPS POST + HMAC + retry + circuit-breaker path as a real delivery — " +
  "if the receiver doesn't see this event, it won't see real ones either. " +
  "Off by default — requires OMNIFOCUS_WEBHOOKS_ENABLED=1. " +
  "Do NOT use this for load testing — circuit-breaker counters apply to synthetic events too. " +
  "Returns { name, delivered: true } on dispatch success, { name, error } when the webhook " +
  "is not registered. Note: 'delivered' means the dispatcher attempted delivery; the receiver's " +
  "actual response is not surfaced (per ADR-0016 §4e: failures log to stderr, never throw upward). " +
  "Side effects: makes one outbound HTTPS POST to the registered URL with a synthetic event payload. " +
  'Example: webhook_test({ name: "slack-billing" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const webhookTestInputSchema = z.object({
  name: webhookNameSchema.describe(
    "Name of the registered webhook to fire a synthetic event through.",
  ),
});

export type WebhookTestInput = z.infer<typeof webhookTestInputSchema>;

// ---------------------------------------------------------------------------
// Context + handler
// ---------------------------------------------------------------------------

export interface WebhookTestContext {
  orchestrator: WebhookOrchestrator;
  enabled: boolean;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleWebhookTest(input: WebhookTestInput, ctx: WebhookTestContext) {
  if (!ctx.enabled) {
    throw new ValidationError(
      "Webhook subsystem is disabled. Set OMNIFOCUS_WEBHOOKS_ENABLED=1 in the environment to enable.",
      { details: { field: "OMNIFOCUS_WEBHOOKS_ENABLED" } },
    );
  }
  const result = await ctx.orchestrator.fireSynthetic(input.name);
  if ("delivered" in result) {
    return ok({ name: input.name, delivered: true as const }, ctx.makeMeta());
  }
  return ok({ name: input.name, error: result.error }, ctx.makeMeta());
}

export function registerWebhookTestTool(server: McpServer, ctx: WebhookTestContext) {
  return server.registerTool(
    "webhook_test",
    { description: WEBHOOK_TEST_DESCRIPTION, inputSchema: webhookTestInputSchema.shape },
    async (args: WebhookTestInput) => {
      const envelope = await handleWebhookTest(args, ctx);
      return toolResponse(envelope);
    },
  );
}
