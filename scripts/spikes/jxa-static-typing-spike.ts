#!/usr/bin/env tsx
/**
 * JXA static-typing spike — feasibility check for generating a `.d.ts` from
 * the OmniFocus `.sdef` (AppleScript scripting dictionary).
 *
 * Usage:
 *   tsx scripts/spikes/jxa-static-typing-spike.ts
 *
 * Requires OmniFocus to be installed (reads /Applications/OmniFocus.app/...).
 * Output feeds docs/spikes/2026-05-jxa-static-typing.md (issue #826).
 *
 * What it does:
 *   1. Parses the .sdef XML.
 *   2. Walks the OmniFocus suite — extracts every <class>, <property>,
 *      <element>, and <class-extension>.
 *   3. Maps AppleScript names (kebab-case) to JXA accessors (camelCase).
 *   4. Emits a partial `.d.ts` covering 3 representative classes:
 *      Folder (a quirky container — parent missing in 4.x),
 *      Tag (also quirky), and
 *      Task (the busiest entity).
 *   5. Reports against the OF 4.x quirks documented in
 *      `src/scripts/jxa/CLAUDE.md` — which would static types catch?
 *
 * The output is a *prototype*, not a production generator. It validates the
 * approach; a production version would handle inheritance, command shapes,
 * and the full class graph.
 */

import { readFileSync, writeFileSync } from "node:fs";

const SDEF_PATH = "/Applications/OmniFocus.app/Contents/Resources/OmniFocus.sdef";
const OUT_PATH = "/tmp/of-jxa-types.d.ts";

// ---------------------------------------------------------------------------
// Minimal XML walker (.sdef has no nested same-element ambiguity at this depth)
// ---------------------------------------------------------------------------

type Property = { name: string; type: string; access: "r" | "rw" };
type Element = { name: string; type: string };
type ClassDef = {
  name: string;
  code: string;
  inherits: string | null;
  properties: Property[];
  elements: Element[];
};

function camelCase(kebabOrSpace: string): string {
  return kebabOrSpace
    .split(/[-\s]+/)
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

function mapType(asType: string): string {
  // .sdef → TypeScript primitive map. Conservative — `any` for unknown
  // entity types so the spike doesn't claim more coverage than it has.
  switch (asType) {
    case "text":
    case "rich text":
      return "string";
    case "boolean":
      return "boolean";
    case "integer":
    case "real":
    case "number":
      return "number";
    case "date":
      return "Date";
    default:
      return "any"; // entity references — would resolve to interface in full impl
  }
}

function attr(attrs: string, key: string, fallback = ""): string {
  return attrs.match(new RegExp(`\\b${key}="([^"]+)"`))?.[1] ?? fallback;
}

function parseClass(xmlChunk: string): ClassDef | null {
  const head = xmlChunk.match(/<class\s+([^>]+)>/);
  if (!head) return null;
  const headAttrs = head[1] ?? "";
  const name = attr(headAttrs, "name");
  const code = attr(headAttrs, "code");
  const inherits = attr(headAttrs, "inherits") || null;

  const properties: Property[] = [];
  for (const m of xmlChunk.matchAll(/<property\s+([^>]+?)\s*\/?>/g)) {
    const propAttrs = m[1] ?? "";
    const pname = attr(propAttrs, "name");
    const ptype = attr(propAttrs, "type", "any");
    const access = attr(propAttrs, "access", "rw") === "r" ? "r" : "rw";
    if (pname) properties.push({ name: pname, type: ptype, access });
  }

  const elements: Element[] = [];
  for (const m of xmlChunk.matchAll(/<element\s+[^>]*?type="([^"]+)"[^>]*?\/?>/g)) {
    const etype = m[1] ?? "";
    elements.push({ name: `${etype}s`, type: etype });
  }

  return { name, code, inherits, properties, elements };
}

function extractClasses(xml: string): ClassDef[] {
  const classes: ClassDef[] = [];
  const re = /<class\s+[^>]*>[\s\S]*?<\/class>/g;
  for (const m of xml.matchAll(re)) {
    const def = parseClass(m[0]);
    if (def) classes.push(def);
  }
  return classes;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

function emitInterface(cls: ClassDef): string {
  const lines: string[] = [];
  const tsName = cls.name
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  lines.push(`/** OmniFocus '${cls.name}' (sdef code: ${cls.code}) */`);
  lines.push(`export interface ${tsName} {`);
  for (const p of cls.properties) {
    const acc = camelCase(p.name);
    const ts = mapType(p.type);
    // JXA convention: property reads are zero-arg function calls.
    lines.push(`  /** ${p.access === "r" ? "read-only" : "read-write"} */`);
    lines.push(`  ${acc}(): ${ts};`);
  }
  for (const e of cls.elements) {
    const acc = camelCase(e.name);
    lines.push(`  /** child collection — ${e.type} */`);
    lines.push(`  ${acc}(): any[];`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Quirk-coverage analysis
// ---------------------------------------------------------------------------

type Quirk = {
  name: string;
  pattern: string; // what the JXA call looks like
  caughtBy: "static-types" | "runtime-only";
  reason: string;
};

const DOCUMENTED_QUIRKS: Quirk[] = [
  {
    name: "tag.parent() throws (use container)",
    pattern: "tag.parent()",
    caughtBy: "static-types",
    reason: "no `parent` property on `tag` class in OF 4.x .sdef",
  },
  {
    name: "folder.parent() throws (use container)",
    pattern: "folder.parent()",
    caughtBy: "static-types",
    reason: "no `parent` property on `folder` class in OF 4.x .sdef (#515)",
  },
  {
    name: "tag.containingTag() throws",
    pattern: "tag.containingTag()",
    caughtBy: "static-types",
    reason: "no `containing tag` property on `tag` class",
  },
  {
    name: "containingProject().class() throws on real projects",
    pattern: "task.containingProject().class()",
    caughtBy: "runtime-only",
    reason: "`class()` exists at type level; throws only at runtime on Project specifiers (#673)",
  },
  {
    name: "creationDate() may throw 'Can't get object'",
    pattern: "task.creationDate()",
    caughtBy: "runtime-only",
    reason: "property is in .sdef; throws are runtime quirks only (#498)",
  },
  {
    name: "flattenedTasks.byId() returns -1728 specifier on miss",
    pattern: "doc.flattenedTasks.byId(badId)",
    caughtBy: "runtime-only",
    reason:
      "byId returns a stub specifier with error code, not null — type system can't see it (#674)",
  },
  {
    name: "naive flattenedTasks() blows scriptRunner timeout",
    pattern: "doc.flattenedTasks() (full DB)",
    caughtBy: "runtime-only",
    reason: "perf regression; types only model API shape, not cost",
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const xml = readFileSync(SDEF_PATH, "utf8");
  const classes = extractClasses(xml);

  // Pick the 3 representative target classes for the spike's prototype.
  const TARGET = ["folder", "tag", "task"];
  const targetClasses = classes.filter((c) => TARGET.includes(c.name));

  console.log(`# JXA static-typing spike — generator output`);
  console.log(`# Source: ${SDEF_PATH}`);
  console.log(`# Total classes parsed: ${classes.length}`);
  console.log(`# Target classes: ${targetClasses.map((c) => c.name).join(", ")}`);
  console.log("");

  // Emit .d.ts for the targets
  const dtsParts: string[] = [
    "// AUTO-GENERATED by scripts/spikes/jxa-static-typing-spike.ts",
    "// Source: /Applications/OmniFocus.app/Contents/Resources/OmniFocus.sdef",
    "// This is a SPIKE prototype — not for production use.",
    "",
  ];
  for (const cls of targetClasses) {
    dtsParts.push(emitInterface(cls), "");
  }
  writeFileSync(OUT_PATH, dtsParts.join("\n"));
  console.log(`Wrote ${OUT_PATH}`);
  console.log("");

  // Property summary
  console.log(`## Property counts (informs scaling estimate)`);
  for (const cls of targetClasses) {
    console.log(
      `  ${cls.name.padEnd(8)} | ${cls.properties.length.toString().padStart(2)} properties | ${cls.elements.length.toString().padStart(2)} elements`,
    );
  }
  console.log("");

  // Quirk analysis — would .sdef-derived types catch each quirk?
  console.log(`## Documented OF 4.x quirks vs static-type detection`);
  console.log("");
  let staticCount = 0;
  let runtimeCount = 0;
  for (const q of DOCUMENTED_QUIRKS) {
    const flag = q.caughtBy === "static-types" ? "✅" : "❌";
    console.log(`  ${flag} ${q.name}`);
    console.log(`     pattern : ${q.pattern}`);
    console.log(`     reason  : ${q.reason}`);
    if (q.caughtBy === "static-types") staticCount++;
    else runtimeCount++;
  }
  console.log("");
  console.log(
    `## Coverage: ${staticCount} of ${DOCUMENTED_QUIRKS.length} documented quirks would be caught at static-type time`,
  );
  console.log(
    `   ${runtimeCount} of ${DOCUMENTED_QUIRKS.length} are runtime-only (need probe / custom-rule / sandbox)`,
  );

  // Confirm key absence claims by inspecting the parsed types
  console.log("");
  console.log(`## Spot-check absence claims (against parsed .sdef)`);
  for (const cls of targetClasses) {
    const hasParent = cls.properties.some((p) => p.name === "parent");
    const hasContainer = cls.properties.some((p) => p.name === "container");
    const hasContainingTag = cls.properties.some((p) => p.name === "containing tag");
    console.log(
      `  ${cls.name.padEnd(8)} | parent: ${hasParent ? "PRESENT" : "ABSENT "} | container: ${hasContainer ? "present" : "absent "} | containing-tag: ${hasContainingTag ? "PRESENT" : "absent"}`,
    );
  }
}

main();
