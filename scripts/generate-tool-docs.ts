#!/usr/bin/env tsx
import * as fs from "node:fs";
import * as path from "node:path";
import type { z } from "zod";
import { ALL_TOOL_DESCRIPTIONS } from "../src/tools/allDescriptions.js";
import { ALL_INPUT_SCHEMAS } from "../src/tools/allInputSchemas.js";

// ---------------------------------------------------------------------------
// Zod introspection helpers
// ---------------------------------------------------------------------------

// Zod 4 replaces the class hierarchy with a tagged-union: every schema has a
// `def.type` discriminator string. We use that instead of `instanceof`, which
// breaks across the v3→v4 class renames (ZodEffects → ZodPipe, ZodBranded
// removed, etc.).
// biome-ignore lint/suspicious/noExplicitAny: runtime introspection of unknown zod schemas
type AnyZodSchema = z.ZodType<any, any>;

function schemaDef(schema: AnyZodSchema): { type: string; [k: string]: unknown } {
  // biome-ignore lint/suspicious/noExplicitAny: zod internals
  return (schema as any).def as { type: string; [k: string]: unknown };
}

function zodTypeLabel(schema: AnyZodSchema): string {
  const def = schemaDef(schema);
  switch (def.type) {
    case "optional":
    case "default":
    case "prefault":
    case "nullable":
    case "readonly":
    case "pipe": {
      const inner = (def.innerType ?? def.in) as AnyZodSchema | undefined;
      const label = inner !== undefined ? zodTypeLabel(inner) : "unknown";
      return def.type === "nullable" ? `${label} | null` : label;
    }
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const element = def.element as AnyZodSchema;
      return `${zodTypeLabel(element)}[]`;
    }
    case "enum": {
      const entries = def.entries as Record<string, string>;
      return `one of: ${Object.values(entries).join(" | ")}`;
    }
    case "literal": {
      const values = def.values as readonly unknown[];
      return `literal: ${JSON.stringify(values.length === 1 ? values[0] : values)}`;
    }
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

function isOptionalField(schema: AnyZodSchema): boolean {
  const t = schemaDef(schema).type;
  return t === "optional" || t === "default" || t === "prefault";
}

interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function schemaToRows(schema: z.ZodObject<z.ZodRawShape>): FieldRow[] {
  const shape = schema.shape;
  return Object.entries(shape).map(([name, field]) => {
    const required = !isOptionalField(field as z.ZodTypeAny);
    const typeLabel = zodTypeLabel(field as z.ZodTypeAny);
    const desc = (field as z.ZodTypeAny).description ?? "";
    return { name, type: typeLabel, required, description: desc };
  });
}

function renderParamTable(rows: FieldRow[]): string {
  if (rows.length === 0) return "_No parameters._\n";
  const lines = [
    "| Parameter | Type | Required | Description |",
    "|-----------|------|----------|-------------|",
  ];
  for (const row of rows) {
    const req = row.required ? "Yes" : "No";
    // Escape pipe characters in descriptions
    const desc = row.description.replace(/\|/g, "\\|");
    lines.push(`| \`${row.name}\` | ${row.type} | ${req} | ${desc} |`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Example call / response generation
// ---------------------------------------------------------------------------

/**
 * Plausible minimal example argument values per tool.
 * Only 1-2 key params shown; IDs use "abc123" placeholder.
 */
const EXAMPLE_CALLS: Record<string, Record<string, unknown>> = {
  folder_create: { name: "Work" },
  folder_delete: { id: "abc123" },
  folder_get: { id: "abc123" },
  folder_list: {},
  folder_move: { id: "abc123", parentId: "def456" },
  folder_update: { id: "abc123", name: "Personal" },
  note_append: { targetKind: "task", id: "abc123", text: "Follow up tomorrow." },
  note_get: { targetKind: "task", id: "abc123" },
  note_get_html: { targetKind: "task", id: "abc123" },
  note_set: { targetKind: "task", id: "abc123", note: "New note text." },
  note_set_html: { targetKind: "project", id: "abc123", noteHtml: "<p>Updated note.</p>" },
  project_delete: { id: "abc123" },
  search_query: { q: "meeting", scope: "name" },
  sync_status: {},
  sync_trigger: {},
  tag_create: { name: "Waiting" },
  tag_delete: { id: "abc123" },
  tag_get: { id: "abc123" },
  tag_get_location: { id: "abc123" },
  tag_list: {},
  tag_move: { id: "abc123", parentId: "def456" },
  tag_set_allows_next_action: { id: "abc123", allowsNextAction: true },
  tag_set_location: {
    id: "abc123",
    latitude: 37.7749,
    longitude: -122.4194,
    radiusMeters: 200,
    trigger: "entering",
  },
  tag_set_status: { id: "abc123", status: "on-hold" },
  tag_update: { id: "abc123", name: "Errands" },
  task_clear_repetition: { id: "abc123" },
  task_delete: { id: "abc123" },
  task_find_by_name: { query: "Buy groceries", mode: "exact" },
  task_get: { id: "abc123" },
  task_get_many: { ids: ["abc123", "def456"] },
  task_list: { flagged: true, limit: 20 },
  task_set_repetition: {
    id: "abc123",
    rule: { method: "fixed", unit: "weeks", steps: 1 },
  },
  task_update: { id: "abc123", flagged: true },
};

/**
 * Representative response data shapes per tool.
 */
const EXAMPLE_DATA: Record<string, unknown> = {
  folder_create: { folder: { id: "abc123", name: "Work", parentId: null } },
  folder_delete: { deleted: true, id: "abc123" },
  folder_get: { folder: { id: "abc123", name: "Work", parentId: null } },
  folder_list: { folders: [{ id: "abc123", name: "Work", parentId: null }] },
  folder_move: { folder: { id: "abc123", name: "Work", parentId: "def456" } },
  folder_update: { folder: { id: "abc123", name: "Personal", parentId: null } },
  note_append: { id: "abc123", note: "Existing note.\nFollow up tomorrow." },
  note_get: { id: "abc123", note: "Meeting notes here." },
  note_get_html: { id: "abc123", noteHtml: "<p>Meeting notes here.</p>" },
  note_set: { id: "abc123", note: "New note text." },
  note_set_html: { id: "abc123", noteHtml: "<p>Updated note.</p>" },
  project_delete: { deleted: true, id: "abc123" },
  search_query: { tasks: [{ id: "abc123", name: "Prepare meeting agenda" }], total: 1 },
  sync_status: { lastSync: "2026-04-23T12:00:00-04:00", syncEnabled: true },
  sync_trigger: { triggered: true },
  tag_create: { tag: { id: "abc123", name: "Waiting", status: "active" } },
  tag_delete: { deleted: true, id: "abc123" },
  tag_get: { tag: { id: "abc123", name: "Waiting", status: "active" } },
  tag_get_location: { location: { latitude: 37.7749, longitude: -122.4194, radiusMeters: 200 } },
  tag_list: { tags: [{ id: "abc123", name: "Waiting", status: "active" }] },
  tag_move: { tag: { id: "abc123", name: "Waiting", parentId: "def456" } },
  tag_set_allows_next_action: { tag: { id: "abc123", allowsNextAction: true } },
  tag_set_location: { tag: { id: "abc123", name: "Office", location: { latitude: 37.7749 } } },
  tag_set_status: { tag: { id: "abc123", status: "on-hold" } },
  tag_update: { tag: { id: "abc123", name: "Errands" } },
  task_clear_repetition: { id: "abc123", repetition: null },
  task_delete: { deleted: true, id: "abc123" },
  task_find_by_name: { tasks: [{ id: "abc123", name: "Buy groceries" }], total: 1 },
  task_get: { task: { id: "abc123", name: "Buy groceries", flagged: false, completed: false } },
  task_get_many: {
    tasks: [
      { id: "abc123", name: "Buy groceries" },
      { id: "def456", name: "Call dentist" },
    ],
  },
  task_list: {
    tasks: [{ id: "abc123", name: "Buy groceries", flagged: true }],
    pagination: { total: 1, limit: 20, offset: 0 },
  },
  task_set_repetition: { id: "abc123", rule: { method: "fixed", unit: "weeks", steps: 1 } },
  task_update: {
    task: { id: "abc123", name: "Buy groceries", flagged: true, completed: false },
  },
};

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderToolSection(toolName: string): string {
  const description = ALL_TOOL_DESCRIPTIONS[toolName] ?? "";
  const schema = ALL_INPUT_SCHEMAS[toolName];
  const rows = schema ? schemaToRows(schema) : [];
  const exampleArgs = EXAMPLE_CALLS[toolName] ?? {};
  const exampleData = EXAMPLE_DATA[toolName] ?? {};

  const exampleCall = JSON.stringify({ toolName, arguments: exampleArgs }, null, 2);
  const exampleResponse = JSON.stringify(
    {
      ok: true,
      data: exampleData,
      meta: { requestId: "req_01ABC", durationMs: 5 },
    },
    null,
    2,
  );

  return [
    `## ${toolName}`,
    "",
    description,
    "",
    "### Input",
    "",
    renderParamTable(rows),
    "### Example call",
    "",
    "```json",
    exampleCall,
    "```",
    "",
    "### Example response",
    "",
    "```json",
    exampleResponse,
    "```",
    "",
  ].join("\n");
}

function generateDocs(): string {
  const toolNames = Object.keys(ALL_TOOL_DESCRIPTIONS).sort();
  const sections = toolNames.map(renderToolSection);

  const header = [
    "<!-- Generated by scripts/generate-tool-docs.ts — do not edit manually -->",
    "",
    "# OmniFocus MCP Tool Reference",
    "",
    `> Auto-generated from source. ${toolNames.length} tools registered.`,
    "",
    "## Table of contents",
    "",
    ...toolNames.map((name) => `- [${name}](#${name.replace(/_/g, "_")})`),
    "",
    "---",
    "",
  ].join("\n");

  return header + sections.join("---\n\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const DOCS_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../docs/tools.md");

const checkMode = process.argv.includes("--check");
const generated = generateDocs();

if (checkMode) {
  const existing = fs.existsSync(DOCS_PATH) ? fs.readFileSync(DOCS_PATH, "utf8") : "";
  if (existing === generated) {
    console.error("docs/tools.md is up to date.");
    process.exit(0);
  } else {
    console.error("docs/tools.md is out of date. Run `pnpm run docs:generate` to regenerate it.");
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(DOCS_PATH), { recursive: true });
  fs.writeFileSync(DOCS_PATH, generated, "utf8");
  console.error(
    `Written: ${DOCS_PATH} (${generated.length} bytes, ${Object.keys(ALL_TOOL_DESCRIPTIONS).length} tools)`,
  );
}
