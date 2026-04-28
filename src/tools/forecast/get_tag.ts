/**
 * `forecast_get_tag` MCP tool — read the forecast-tag preference.
 *
 * The forecast tag is the single tag whose tasks always appear on the
 * Forecast view alongside dated items. Reading it lets an agent answer
 * "what tag does the user use as their daily agenda?" without guessing.
 *
 * @see #465
 * @see src/scripts/omnijs/forecast_get_tag.js
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type ResponseMeta, toolResponse } from "../../envelope/index.js";
import type { ForecastService } from "../../services/forecastService.js";

export const FORECAST_GET_TAG_DESCRIPTION =
  "Read the OmniFocus forecast-tag preference: the single tag whose tasks always appear on the Forecast view alongside dated items. " +
  "Use when the agent needs to answer 'what tag is the user using as their daily agenda?' or to confirm a tag before composing follow-up queries against it. " +
  "Do NOT use to list tags in general — prefer tag_list. " +
  "Takes no arguments. " +
  "Returns { tagId: string | null, name: string | null } — name is the tag's display name (or null when tagId is null or the tag has been deleted) so the agent can describe the forecast tag without a follow-up tag_get. " +
  "Read-only; no side effects; safe to retry. Backed by OmniJS Database.forecastTag."" +
  "Example: forecast_get_tag()";

export const forecastGetTagInputSchema = z.object({});

export type ForecastGetTagToolInput = z.infer<typeof forecastGetTagInputSchema>;

export interface ForecastGetTagContext {
  forecastService: ForecastService;
  makeMeta: (partial?: Partial<ResponseMeta>) => ResponseMeta;
}

export async function handleForecastGetTag(
  _input: ForecastGetTagToolInput,
  ctx: ForecastGetTagContext,
) {
  const result = await ctx.forecastService.getForecastTag();
  return ok(result, ctx.makeMeta());
}

export function registerForecastGetTagTool(server: McpServer, ctx: ForecastGetTagContext) {
  return server.registerTool(
    "forecast_get_tag",
    {
      description: FORECAST_GET_TAG_DESCRIPTION,
      inputSchema: forecastGetTagInputSchema.shape,
    },
    async (args: ForecastGetTagToolInput) => {
      const envelope = await handleForecastGetTag(args, ctx);
      return toolResponse(envelope);
    },
  );
}
