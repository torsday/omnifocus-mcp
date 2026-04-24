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
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("internal_status");
    // Folder tools (#298): six register* helpers wired in startServer.
    expect(names).toContain("folder_list");
    expect(names).toContain("folder_create");
    expect(names).toContain("folder_delete");
    // Tag tools (#298): ten register* helpers wired in startServer.
    expect(names).toContain("tag_list");
    expect(names).toContain("tag_set_status");
    // Mid-domain tools (#300): note + search + forecast + perspective +
    // plugin + sync + review + export + app — 20 tools across nine domains.
    expect(names).toContain("note_append");
    expect(names).toContain("note_get");
    expect(names).toContain("note_set_html");
    expect(names).toContain("search_query");
    expect(names).toContain("forecast_get");
    expect(names).toContain("perspective_list");
    expect(names).toContain("perspective_evaluate");
    expect(names).toContain("plugin_invoke");
    expect(names).toContain("sync_status");
    expect(names).toContain("sync_trigger");
    expect(names).toContain("review_list_due");
    expect(names).toContain("review_mark_reviewed");
    expect(names).toContain("project_mark_reviewed");
    expect(names).toContain("review_set_interval");
    expect(names).toContain("export_opml");
    expect(names).toContain("export_taskpaper");
    expect(names).toContain("import_taskpaper");
    expect(names).toContain("app_launch");
    // Project tools (#303): eight register* helpers wired in startServer.
    expect(names).toContain("project_complete");
    expect(names).toContain("project_create");
    expect(names).toContain("project_delete");
    expect(names).toContain("project_drop");
    expect(names).toContain("project_get");
    expect(names).toContain("project_list");
    expect(names).toContain("project_move");
    expect(names).toContain("project_update");
    // Task tools (#305): twenty register* helpers wired in startServer.
    expect(names).toContain("task_get");
    expect(names).toContain("task_list");
    expect(names).toContain("task_find_by_name");
    expect(names).toContain("task_get_many");
    expect(names).toContain("task_parse_transport_text");
    expect(names).toContain("task_create");
    expect(names).toContain("task_update");
    expect(names).toContain("task_delete");
    expect(names).toContain("task_complete");
    expect(names).toContain("task_uncomplete");
    expect(names).toContain("task_drop");
    expect(names).toContain("task_undrop");
    expect(names).toContain("task_move");
    expect(names).toContain("task_reorder");
    expect(names).toContain("task_duplicate");
    expect(names).toContain("task_set_repetition");
    expect(names).toContain("task_clear_repetition");
    expect(names).toContain("task_batch_complete");
    expect(names).toContain("task_batch_create");
    expect(names).toContain("task_batch_update");
    // Attachment tools (#307): four register* helpers wired via the
    // registerAttachmentTools index helper.
    expect(names).toContain("attachment_list");
    expect(names).toContain("attachment_add");
    expect(names).toContain("attachment_remove");
    expect(names).toContain("attachment_save_to_path");
    // Raw-script escape hatches (#307) are gated on OMNIFOCUS_ALLOW_RAW_SCRIPT
    // and stay off by default — verify they do NOT appear here.
    expect(names).not.toContain("run_jxa_script");
    expect(names).not.toContain("run_omnijs_script");
    expect(tools.tools.length).toBeGreaterThanOrEqual(69);

    const result = await server.client.callTool({ name: "internal_status", arguments: {} });
    const structured = result.structuredContent as { data?: { uptimeMs?: number } } | undefined;
    expect(typeof structured?.data?.uptimeMs).toBe("number");
    expect(structured?.data?.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("lists the four OmniFocus workflow prompts", async () => {
    try {
      await server.start();
    } catch (err) {
      throw new Error(
        `E2EServer.start() failed: ${String(err)}\n` + `stderr: ${server.stderrBuffer}`,
      );
    }

    const prompts = await server.client.listPrompts();
    const names = prompts.prompts.map((p) => p.name).sort();
    expect(names).toEqual(
      ["capture-meeting", "daily-review", "project-planning", "weekly-review"].sort(),
    );

    const daily = await server.client.getPrompt({ name: "daily-review", arguments: {} });
    expect(daily.messages.length).toBeGreaterThan(0);
    expect(daily.messages[0]?.role).toBe("user");
  });

  it("lists the ten MCP resources and reads omnifocus://capabilities", async () => {
    try {
      await server.start();
    } catch (err) {
      throw new Error(
        `E2EServer.start() failed: ${String(err)}\n` + `stderr: ${server.stderrBuffer}`,
      );
    }

    const resources = await server.client.listResources();
    const uris = resources.resources.map((r) => r.uri).sort();
    expect(uris).toContain("omnifocus://capabilities");
    expect(uris).toContain("omnifocus://snapshot");
    expect(uris).toContain("omnifocus://inbox");
    expect(uris).toContain("omnifocus://forecast/today");
    expect(uris).toContain("omnifocus://overdue");
    expect(uris).toContain("omnifocus://flagged");
    expect(uris).toContain("omnifocus://review-due");
    // Static-URI resources only — the three template URIs surface via
    // resources/templates/list, not resources/list.
    expect(uris.length).toBeGreaterThanOrEqual(7);

    const capabilities = await server.client.readResource({
      uri: "omnifocus://capabilities",
    });
    expect(capabilities.contents.length).toBeGreaterThan(0);
    const first = capabilities.contents[0] as { mimeType?: string; text?: string };
    expect(first?.mimeType).toBe("application/json");
    const parsed = JSON.parse(first?.text ?? "") as {
      ofVersion: string;
      ofEdition: string;
      transports: { jxa: { available: boolean } };
    };
    expect(parsed.ofVersion).toBeTypeOf("string");
    expect(parsed.transports.jxa.available).toBe(true);
  });
});
