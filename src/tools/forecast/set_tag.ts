/**
 * `forecast_set_tag` MCP tool — set or clear the forecast-tag preference.
 *
 * Pass a `tagId` to set, or `null` to clear. The forecast tag is the single
 * tag whose tasks always appear on the Forecast view alongside dated items;
 * setting it during onboarding flows is a common agent task.
 *
 * Mutation: invalidates the forecast read cache so subsequent forecast_get
 * calls reflect the new agenda surface.
 *
 * @see #465 / #849
 * @see src/scripts/omnijs/forecast_tag_set_with_name.js
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InvalidatingCache } from "../../cache/invalidation.js";
import { TagId } from "../../domain/ids.js";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ForecastService } from "../../services/forecastService.js";

export const FORECAST_SET_TAG_DESCRIPTION =
  "Set or clear the OmniFocus forecast-tag preference. " +
  "Use when the user wants to designate (or change) the tag whose tasks should always appear on Forecast — common during onboarding flows or context switches ('use @today as my agenda'). " +
  "Do NOT use to add tags to a task — prefer task_update. " +
  "Pass tagId as a TagId string to set, or null to clear. " +
  "Returns { tagId: string | null, name: string | null } echoing what was applied — name is paired with the tag id so the agent can describe the change without a follow-up tag_get. " +
  "Errors: NOT_FOUND when the supplied tagId does not exist. " +
  "Side effects: mutation; invalidates the forecast read cache. " +
  "Backed by OmniJS Database.forecastTag. " +
  'Example: forecast_set_tag({ tagId: "tag123" }) ' +
  "Example: forecast_set_tag({ tagId: null })";

export const forecastSetTagInputSchema = z.object({
  tagId: z
    .union([TagId.schema, z.null()])
    .describe(
      "The TagId to designate as the forecast tag, or null to clear the preference. " +
        "Use null to remove the forecast-tag binding entirely.",
    ),
});

export type ForecastSetTagToolInput = z.infer<typeof forecastSetTagInputSchema>;

export interface ForecastSetTagContext {
  forecastService: ForecastService;
  cache: InvalidatingCache;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleForecastSetTag(
  input: ForecastSetTagToolInput,
  ctx: ForecastSetTagContext,
) {
  const result = await ctx.forecastService.setForecastTag(input.tagId);
  // Forecast view depends on the tag binding; invalidate so subsequent
  // forecast_get calls reflect the new agenda surface.
  ctx.cache.invalidate("forecast:*");
  return ok(result, ctx.makeMeta());
}

export function registerForecastSetTagTool(server: McpServer, ctx: ForecastSetTagContext) {
  return server.registerTool(
    "forecast_set_tag",
    {
      description: FORECAST_SET_TAG_DESCRIPTION,
      inputSchema: forecastSetTagInputSchema.shape,
    },
    async (args: ForecastSetTagToolInput) => {
      const envelope = await handleForecastSetTag(args, ctx);
      return toolResponse(envelope);
    },
  );
}
