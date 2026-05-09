/**
 * Tools-manifest payload measurement (#771).
 *
 * The MCP `tools/list` response is the single largest payload an LLM
 * agent sees per session — every tool's name, description, and JSON
 * input schema. Optimizations in #770 (description trimming, schema
 * compaction) target this surface, so the benchmark needs a stable
 * byte count for it.
 *
 * We rebuild the manifest here from {@link ALL_TOOL_DESCRIPTIONS} and
 * {@link ALL_INPUT_SCHEMAS} rather than booting an `McpServer` and
 * issuing a JSON-RPC `tools/list` call — that path requires the full
 * `startServer()` wiring which is out of scope for #771. The shape
 * matches the SDK's `tools/list` result: `{ tools: [{ name,
 * description, inputSchema }, ...] }` with `inputSchema` produced via
 * Zod v4's built-in `toJSONSchema`. That conversion path is what the
 * MCP SDK uses internally on Zod v4 schemas, so the byte count tracks
 * the wire payload to within JSON-RPC framing overhead.
 */

import { z } from "zod";
import { ALL_TOOL_DESCRIPTIONS } from "../../../src/tools/allDescriptions.js";
import { ALL_INPUT_SCHEMAS } from "../../../src/tools/allInputSchemas.js";
import { jsonByteLength } from "./byteCounter.js";

interface ManifestEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Build the manifest payload (deterministic key order). */
export function buildToolsListPayload(): { tools: ManifestEntry[] } {
  const names = Object.keys(ALL_TOOL_DESCRIPTIONS).sort();
  const tools: ManifestEntry[] = names.map((name) => {
    const description = ALL_TOOL_DESCRIPTIONS[name] ?? "";
    const schema = ALL_INPUT_SCHEMAS[name];
    const inputSchema =
      schema !== undefined
        ? (z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>)
        : { type: "object", properties: {}, additionalProperties: false };
    return { name, description, inputSchema };
  });
  return { tools };
}

/** UTF-8 byte length of the serialized tools/list payload. */
export function computeToolsListBytes(): number {
  return jsonByteLength(buildToolsListPayload());
}
