/**
 * Per-tool E2E coverage (#80, ADR-0014).
 *
 * Spawns the bundled server with `OMNIFOCUS_E2E_USE_MEMORY=1` so every
 * registered tool dispatches against the in-memory adapter, then invokes
 * each tool from the live `tools/list` manifest with minimal valid args.
 *
 * Each tool's response must be a valid MCP `CallToolResult` carrying either
 * a success envelope (`structuredContent.data` present) or a typed-error
 * outcome (`isError: true` with a text content channel — what the SDK
 * builds when the handler throws an `OmniFocusError`). Both outcomes prove
 * registration, schema validation, middleware composition, and envelope
 * generation are wired correctly for that tool. The integration tier on
 * `mac-local` (`OMNIFOCUS_INTEGRATION=1`) covers the live-OF behavior the
 * in-memory adapter cannot model.
 *
 * **Fixture discipline.** Every tool listed by `listTools()` must have an
 * entry in `TOOL_INPUTS`. The test enforces this — adding a new tool
 * without a fixture is a build break. Fake IDs use the
 * `OMNIFOCUS_ID_PATTERN` shape (`[A-Za-z0-9_-]{3,64}`); the in-memory
 * adapter returns `OF_NOT_FOUND` for unknown IDs, which the test accepts
 * as a valid typed-error path.
 *
 * @see docs/adr/0014-e2e-harness-strategy.md
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2EServer } from "./E2EServer.js";

const E2E = process.env.OMNIFOCUS_E2E === "1";

// Fake well-formed IDs. The in-memory adapter starts empty so every lookup
// throws `OF_NOT_FOUND` — a valid typed-error outcome for the harness.
const FAKE_FOLDER_ID = "fake-folder-1";
const FAKE_PROJECT_ID = "fake-project-1";
const FAKE_TAG_ID = "fake-tag-1";
const FAKE_TASK_ID = "fake-task-1";
const FAKE_ATTACHMENT_ID = "fake-attachment-1";

/**
 * Minimal valid args per tool. Reads with no required input get `{}`;
 * mutations get the smallest payload that passes the zod schema. Keep
 * this map sorted alphabetically by tool name so additions are easy to
 * spot in review.
 */
const TOOL_INPUTS: Record<string, Record<string, unknown>> = {
  app_launch: {},

  attachment_add: { taskId: FAKE_TASK_ID, path: "/tmp/nonexistent.txt" },
  attachment_list: { taskId: FAKE_TASK_ID },
  attachment_remove: { taskId: FAKE_TASK_ID, attachmentId: FAKE_ATTACHMENT_ID },
  attachment_save_to_path: {
    taskId: FAKE_TASK_ID,
    attachmentId: FAKE_ATTACHMENT_ID,
    destinationPath: "/tmp/out.bin",
  },

  export_opml: {},
  export_taskpaper: {},
  import_taskpaper: { text: "- task one\n- task two\n" },

  folder_create: { name: "E2E test folder" },
  folder_delete: { id: FAKE_FOLDER_ID },
  folder_get: { id: FAKE_FOLDER_ID },
  folder_list: {},
  folder_move: { id: FAKE_FOLDER_ID, parentId: null },
  folder_update: { id: FAKE_FOLDER_ID, name: "renamed" },

  forecast_get: {},

  internal_status: {},

  note_append: { taskId: FAKE_TASK_ID, text: "appended" },
  note_get: { taskId: FAKE_TASK_ID },
  note_get_html: { taskId: FAKE_TASK_ID },
  note_set: { taskId: FAKE_TASK_ID, text: "hello" },
  note_set_html: { taskId: FAKE_TASK_ID, html: "<p>hello</p>" },

  perspective_evaluate: { id: "Inbox" },
  perspective_list: {},

  plugin_invoke: { name: "nonexistent.plugin" },

  project_complete: { id: FAKE_PROJECT_ID },
  project_create: { name: "E2E project" },
  project_delete: { id: FAKE_PROJECT_ID },
  project_drop: { id: FAKE_PROJECT_ID },
  project_get: { id: FAKE_PROJECT_ID },
  project_list: {},
  project_mark_reviewed: { id: FAKE_PROJECT_ID },
  project_move: { id: FAKE_PROJECT_ID, folderId: null },
  project_update: { id: FAKE_PROJECT_ID, name: "renamed" },

  review_list_due: {},
  review_mark_reviewed: { projectId: FAKE_PROJECT_ID },
  review_set_interval: { projectId: FAKE_PROJECT_ID, days: 7 },

  search_query: { query: "test" },

  sync_status: {},
  sync_trigger: {},

  tag_create: { name: "E2E tag" },
  tag_delete: { id: FAKE_TAG_ID },
  tag_get: { id: FAKE_TAG_ID },
  tag_get_location: { id: FAKE_TAG_ID },
  tag_list: {},
  tag_move: { id: FAKE_TAG_ID, parentId: null },
  tag_set_allows_next_action: { id: FAKE_TAG_ID, allowsNextAction: true },
  tag_set_location: { id: FAKE_TAG_ID, latitude: 37.7, longitude: -122.4 },
  tag_set_status: { id: FAKE_TAG_ID, status: "active" },
  tag_update: { id: FAKE_TAG_ID, name: "renamed" },

  task_batch_complete: { ids: [FAKE_TASK_ID] },
  task_batch_create: { tasks: [{ name: "batch task" }] },
  task_batch_update: { updates: [{ id: FAKE_TASK_ID, name: "renamed" }] },
  task_clear_repetition: { id: FAKE_TASK_ID },
  task_complete: { id: FAKE_TASK_ID },
  task_create: { name: "E2E task" },
  task_delete: { id: FAKE_TASK_ID },
  task_drop: { id: FAKE_TASK_ID },
  task_duplicate: { id: FAKE_TASK_ID },
  task_find_by_name: { name: "E2E task" },
  task_get: { id: FAKE_TASK_ID },
  task_get_many: { ids: [FAKE_TASK_ID] },
  task_list: {},
  task_move: { id: FAKE_TASK_ID, projectId: null },
  task_parse_transport_text: { text: "Reply to Alice @email !!" },
  task_reorder: { id: FAKE_TASK_ID, position: "top" },
  task_set_repetition: {
    id: FAKE_TASK_ID,
    rule: { unit: "days", steps: 1, anchor: "due-date", method: "fixed" },
  },
  task_uncomplete: { id: FAKE_TASK_ID },
  task_undrop: { id: FAKE_TASK_ID },
  task_update: { id: FAKE_TASK_ID, name: "renamed" },
};

interface CallToolResultLike {
  structuredContent?: { data?: unknown; meta?: unknown; error?: unknown };
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

/** Either a success envelope or a typed-error outcome counts as valid. */
function assertValidEnvelope(result: CallToolResultLike, toolName: string): void {
  const success = result.structuredContent?.data !== undefined;
  const typedError = result.isError === true;
  if (!success && !typedError) {
    throw new Error(
      `${toolName}: expected structuredContent.data or isError=true; got ${JSON.stringify(result).slice(0, 200)}`,
    );
  }
}

describe.skipIf(!E2E)("E2E — per-tool coverage (in-memory adapter)", () => {
  let server: E2EServer;

  beforeAll(async () => {
    server = new E2EServer({
      env: { OMNIFOCUS_E2E: "1", OMNIFOCUS_E2E_USE_MEMORY: "1" },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("every registered tool has a fixture entry", async () => {
    const { tools } = await server.client.listTools();
    const names = tools.map((t) => t.name).sort();
    const missing = names.filter((n) => !(n in TOOL_INPUTS));
    expect(missing, `tools without fixtures: ${missing.join(", ")}`).toEqual([]);
  });

  it("every registered tool returns a valid envelope or typed error", async () => {
    const { tools } = await server.client.listTools();
    const failures: string[] = [];

    for (const tool of tools) {
      const args = TOOL_INPUTS[tool.name];
      if (args === undefined) continue; // covered by the fixture-coverage test
      try {
        const result = (await server.client.callTool({
          name: tool.name,
          arguments: args,
        })) as CallToolResultLike;
        assertValidEnvelope(result, tool.name);
      } catch (err) {
        failures.push(`${tool.name}: ${(err as Error).message}`);
      }
    }

    expect(failures, failures.join("\n  - ")).toEqual([]);
  });
});
