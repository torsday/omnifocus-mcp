/**
 * Smoke test — spawn the bundled server, speak MCP over stdio, confirm the
 * `initialize → tools/list → tools/call(internal_status)` path works end to
 * end. This is the canonical usage example for {@link E2EServer}; per-tool
 * E2E coverage tracks on #80.
 *
 * `internal_status` is the safest smoke target because it works without a
 * live OmniFocus (reports server uptime + circuit-breaker state), so the
 * harness is green even when the integration env vars are off.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { E2EServer } from "./E2EServer.js";

const E2E = process.env.OMNIFOCUS_E2E === "1";

describe.skipIf(!E2E)("E2E — smoke", () => {
  let server: E2EServer;

  beforeEach(() => {
    server = new E2EServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("lists tools and calls internal_status over stdio", async () => {
    try {
      await server.start();
    } catch (err) {
      throw new Error(
        `E2EServer.start() failed: ${String(err)}\n` + `stderr: ${server.stderrBuffer}`,
      );
    }

    const tools = await server.client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.map((t) => t.name)).toContain("internal_status");

    const result = await server.client.callTool({ name: "internal_status", arguments: {} });
    const structured = result.structuredContent as { data?: { uptimeMs?: number } } | undefined;
    expect(typeof structured?.data?.uptimeMs).toBe("number");
    expect(structured?.data?.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});
