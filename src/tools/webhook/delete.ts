/**
 * `webhook_delete` MCP tool — remove a registered outbound webhook (per ADR-0016, #483 slice 1).
 *
 * Idempotent. Returns `{ deleted: true }` when removed, `{ noChange: true }`
 * when no webhook with that name was registered.
 *
 * Off by default — requires `OMNIFOCUS_WEBHOOKS_ENABLED=1`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, toolResponse } from "../../envelope/index.js";
import { webhookNameSchema } from "../../webhooks/types.js";
import type { WebhookContext } from "./register.js";
import { assertEnabled } from "./register.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const WEBHOOK_DELETE_DESCRIPTION =
  "Delete a registered outbound webhook by name. " +
  "Idempotent — returns noChange:true when the named webhook does not exist. " +
  "Off by default — requires OMNIFOCUS_WEBHOOKS_ENABLED=1. " +
  "Do NOT use this for bulk-clear operations; this tool removes exactly one entry. " +
  "Returns { name, deleted:true } or { name, noChange:true }. " +
  "Side effects: rewrites the registry config file at ~/Library/Application Support/omnifocus-mcp/webhooks.json. " +
  'Example: webhook_delete({ name: "slack-billing" })';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const webhookDeleteInputSchema = z.object({
  name: webhookNameSchema.describe(
    "Name of the registered webhook to delete. Idempotent — unknown names return noChange:true.",
  ),
});

export type WebhookDeleteInput = z.infer<typeof webhookDeleteInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleWebhookDelete(input: WebhookDeleteInput, ctx: WebhookContext) {
  assertEnabled(ctx);
  const removed = ctx.registry.delete(input.name);
  if (removed) {
    return ok({ name: input.name, deleted: true as const }, ctx.makeMeta());
  }
  return ok({ name: input.name, noChange: true as const }, ctx.makeMeta());
}

export function registerWebhookDeleteTool(server: McpServer, ctx: WebhookContext) {
  return server.registerTool(
    "webhook_delete",
    { description: WEBHOOK_DELETE_DESCRIPTION, inputSchema: webhookDeleteInputSchema.shape },
    async (args: WebhookDeleteInput) => {
      const envelope = await handleWebhookDelete(args, ctx);
      return toolResponse(envelope);
    },
  );
}
