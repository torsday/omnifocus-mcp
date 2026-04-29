/**
 * `webhook_list` MCP tool — list registered webhooks (per ADR-0016, #483 slice 1).
 *
 * Returns the public-facing summary for every registered webhook —
 * `{ name, trigger, secretSet, createdAt }`. URLs and secrets are NEVER
 * surfaced through this tool (or any other tool); see ADR-0016 §4d.
 *
 * Off by default — requires `OMNIFOCUS_WEBHOOKS_ENABLED=1`.
 *
 * @see docs/adr/0016-webhook-delivery.md §4d — capability surface
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, toolResponse } from "../../envelope/index.js";
import type { WebhookContext } from "./register.js";
import { assertEnabled } from "./register.js";

// ---------------------------------------------------------------------------
// Tool description
// ---------------------------------------------------------------------------

export const WEBHOOK_LIST_DESCRIPTION =
  "List every registered outbound webhook by name, trigger, and createdAt timestamp. " +
  "URLs and secrets are NEVER surfaced — only metadata safe to display. Use this to confirm what's wired up; " +
  "delete unwanted entries via webhook_delete. " +
  "Off by default — requires OMNIFOCUS_WEBHOOKS_ENABLED=1. " +
  "Do NOT use this to retrieve URLs or secrets — by design they remain on-disk only. " +
  "Returns { webhooks: WebhookSummary[] } in registration order. " +
  "Read-only; safe to call repeatedly. " +
  "Example: webhook_list()";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

export const webhookListInputSchema = z.object({});
export type WebhookListInput = z.infer<typeof webhookListInputSchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleWebhookList(_input: WebhookListInput, ctx: WebhookContext) {
  assertEnabled(ctx);
  return ok({ webhooks: ctx.registry.list() }, ctx.makeMeta());
}

export function registerWebhookListTool(server: McpServer, ctx: WebhookContext) {
  return server.registerTool(
    "webhook_list",
    { description: WEBHOOK_LIST_DESCRIPTION, inputSchema: webhookListInputSchema.shape },
    async (args: WebhookListInput) => {
      const envelope = await handleWebhookList(args, ctx);
      return toolResponse(envelope);
    },
  );
}
