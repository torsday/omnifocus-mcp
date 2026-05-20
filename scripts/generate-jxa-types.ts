#!/usr/bin/env tsx
/**
 * JXA type-declaration generator (#854).
 *
 * Promotes the spike at `scripts/spikes/jxa-static-typing-spike.ts` into a
 * production generator. Reads the pinned `vendor/OmniFocus.sdef` snapshot
 * and emits `src/scripts/jxa/_types/omnifocus.d.ts` covering the full
 * OmniFocus suite (~47 classes, ~256 properties, ~54 elements).
 *
 * Why a snapshot instead of the live sdef?
 *   - CI doesn't have OmniFocus installed — reading
 *     `/Applications/OmniFocus.app/Contents/Resources/OmniFocus.sdef`
 *     would make the generator non-portable.
 *   - The snapshot is the canonical contract — bumping OF support means
 *     refreshing the snapshot (via `pnpm sync:sdef`) and re-running this
 *     generator, both in one explicit step.
 *
 * Usage:
 *   pnpm generate:jxa-types           # regenerate from vendor/OmniFocus.sdef
 *   pnpm sync:sdef                    # refresh the snapshot from live OF, then regenerate
 *
 * The generated `.d.ts` is committed (per the JXA-static-typing decision
 * doc) so CI can typecheck JXA scripts via `// @ts-check` without re-running
 * this generator on every PR. See docs/spikes/2026-05-jxa-static-typing.md.
 *
 * @see #854 — this generator
 * @see #826 — spike feasibility check
 * @see docs/spikes/2026-05-jxa-static-typing.md — decision record
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SDEF_PATH = "vendor/OmniFocus.sdef";
const OUT_PATH = "src/scripts/jxa/_types/omnifocus.d.ts";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface Property {
  name: string;
  type: string;
  access: "r" | "rw";
  description?: string;
}

interface ElementDef {
  /** The .sdef element type name (an existing class name). */
  type: string;
}

interface ClassDef {
  /** Original .sdef class name (lower-case, possibly multi-word). */
  name: string;
  /** Four-letter AppleScript code; kept in the JSDoc for traceability. */
  code: string;
  /** Parent class for inheritance — null for roots. */
  inherits: string | null;
  /** Whether this is a `<class-extension>` (extends an existing class). */
  isExtension: boolean;
  /** Optional human-readable description from .sdef. */
  description?: string;
  properties: Property[];
  elements: ElementDef[];
}

// ---------------------------------------------------------------------------
// XML parsing
//
// The .sdef format is straightforward XML; we use lightweight regex parsing
// rather than a full XML parser because (a) the structure is shallow,
// (b) regex keeps the generator dependency-free, and (c) the OF .sdef has
// stayed shape-stable across the OF 3 → 4 transition.
// ---------------------------------------------------------------------------

function attr(attrs: string, key: string, fallback = ""): string {
  return attrs.match(new RegExp(`\\b${key}="([^"]+)"`))?.[1] ?? fallback;
}

function parseClassBody(body: string): { properties: Property[]; elements: ElementDef[] } {
  const properties: Property[] = [];

  // Self-closing properties: `<property … />` (type on the head line).
  const seenNames = new Set<string>();
  for (const m of body.matchAll(/<property\s+([^>]+?)\/>/g)) {
    const a = m[1] ?? "";
    const pname = attr(a, "name");
    if (!pname || seenNames.has(pname)) continue;
    seenNames.add(pname);
    const ptype = attr(a, "type", "any");
    const description = attr(a, "description") || undefined;
    const access = attr(a, "access", "rw") === "r" ? "r" : "rw";
    properties.push({
      name: pname,
      type: ptype,
      access,
      ...(description !== undefined ? { description } : {}),
    });
  }

  // Open-then-close properties: `<property …>…<type type="X"/>…</property>`.
  // The type may live in nested `<type type="…"/>` children — union when
  // there are multiple (just take the first; TS unions are an enhancement
  // we don't need for OF 4.x correctness today).
  for (const m of body.matchAll(/<property\s+([^>]*?)>([\s\S]*?)<\/property>/g)) {
    const a = m[1] ?? "";
    const inner = m[2] ?? "";
    const pname = attr(a, "name");
    if (!pname || seenNames.has(pname)) continue;
    seenNames.add(pname);
    // type=… on the head still wins if present.
    let ptype = attr(a, "type", "");
    if (!ptype) {
      const typeMatch = inner.match(/<type\s+type="([^"]+)"/);
      ptype = typeMatch?.[1] ?? "any";
    }
    const description = attr(a, "description") || undefined;
    const access = attr(a, "access", "rw") === "r" ? "r" : "rw";
    properties.push({
      name: pname,
      type: ptype,
      access,
      ...(description !== undefined ? { description } : {}),
    });
  }

  const elements: ElementDef[] = [];
  // Self-closing elements: `<element type="…" />`
  for (const m of body.matchAll(/<element\s+[^>]*?type="([^"]+)"[^>]*?\/>/g)) {
    const etype = m[1] ?? "";
    if (etype) elements.push({ type: etype });
  }
  // Open-then-close elements: `<element type="…">…</element>`
  for (const m of body.matchAll(/<element\s+[^>]*?type="([^"]+)"[^>]*?>[\s\S]*?<\/element>/g)) {
    const etype = m[1] ?? "";
    if (etype) elements.push({ type: etype });
  }

  return { properties, elements };
}

function parseClasses(xml: string): ClassDef[] {
  const classes: ClassDef[] = [];

  // Plain `<class …>…</class>`
  for (const m of xml.matchAll(/<class\s+([^>]*?)>([\s\S]*?)<\/class>/g)) {
    const headAttrs = m[1] ?? "";
    const body = m[2] ?? "";
    const name = attr(headAttrs, "name");
    const code = attr(headAttrs, "code");
    const inherits = attr(headAttrs, "inherits") || null;
    const description = attr(headAttrs, "description") || undefined;
    if (!name) continue;
    const { properties, elements } = parseClassBody(body);
    classes.push({
      name,
      code,
      inherits,
      isExtension: false,
      ...(description !== undefined ? { description } : {}),
      properties,
      elements,
    });
  }

  // `<class-extension extends="…">…</class-extension>` — adds properties /
  // elements to an already-defined class. Merge those onto the base class.
  for (const m of xml.matchAll(/<class-extension\s+([^>]*?)>([\s\S]*?)<\/class-extension>/g)) {
    const headAttrs = m[1] ?? "";
    const body = m[2] ?? "";
    const target = attr(headAttrs, "extends");
    if (!target) continue;
    const { properties, elements } = parseClassBody(body);
    const base = classes.find((c) => c.name === target);
    if (base) {
      base.properties.push(...properties);
      base.elements.push(...elements);
    } else {
      // Extension before its target appears — record the orphan so we can
      // surface it in stderr at the end (preserves coverage when sdef
      // ordering shifts in a future OF release).
      classes.push({
        name: target,
        code: "",
        inherits: null,
        isExtension: true,
        properties,
        elements,
      });
    }
  }

  return classes;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

const PRIMITIVE_TYPES: Record<string, string> = {
  text: "string",
  "rich text": "string",
  boolean: "boolean",
  integer: "number",
  real: "number",
  number: "number",
  date: "Date",
  any: "unknown",
  type: "string", // AppleScript type-class identifiers, e.g. `class()` returns
};

function tsClassName(sdefName: string): string {
  // OmniFocus class names are lowercase, sometimes multi-word: "active
  // status", "tag group", etc. Convert to PascalCase for TS.
  return sdefName
    .split(/[-\s]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function tsAccessor(sdefName: string): string {
  // JXA accessor names are kebab-case → camelCase: "creation-date" →
  // "creationDate". Reserved-word fields get a `$` suffix to keep the
  // emitted .d.ts valid TypeScript (no current OF .sdef property hits a
  // reserved word, but the suffix logic is defensive).
  const camel = sdefName
    .split(/[-\s]+/)
    .filter((w) => w.length > 0)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join("");
  const reserved = new Set(["class", "default", "delete", "import", "return", "switch"]);
  return reserved.has(camel) ? `${camel}_` : camel;
}

function mapTypeToTs(sdefType: string, knownClasses: Set<string>): string {
  const primitive = PRIMITIVE_TYPES[sdefType];
  if (primitive !== undefined) return primitive;
  if (knownClasses.has(sdefType)) return tsClassName(sdefType);
  // Unknown type — could be an enum or an external suite class. Stay
  // conservative with `unknown`; entity-reference resolution is what this
  // generator is supposed to do, so an unknown landing here is signal
  // that the snapshot may need re-sync.
  return "unknown";
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

function emitJsDoc(lines: string[], description?: string): void {
  if (!description) return;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return;
  lines.push(`  /** ${cleaned} */`);
}

function emitClass(cls: ClassDef, knownClasses: Set<string>): string {
  const lines: string[] = [];
  const tsName = tsClassName(cls.name);
  const codeNote = cls.code ? ` (sdef code: ${cls.code})` : "";
  lines.push(`/** OmniFocus '${cls.name}' class${codeNote}. */`);

  // Inheritance chain — TypeScript interfaces extend the parent's TS name.
  // Multiple-inheritance isn't expressed in .sdef, so this is always
  // 0-or-1 parent.
  const extendsClause = cls.inherits ? ` extends ${tsClassName(cls.inherits)}` : "";
  // Ambient declaration (no `export`) — `.d.ts` files containing only
  // non-exported declarations are script-mode and their types are
  // available globally to JXA `// @ts-check` consumers via the
  // triple-slash reference (#987). The moment any `export` lands here
  // the file becomes a module and the types disappear from script-mode
  // consumers.
  lines.push(`interface ${tsName}${extendsClause} {`);

  // Properties. JXA reads each property via a zero-arg method call.
  // `parentTask()` etc. — even read-only — are method-shaped at the JXA
  // boundary, which is what these accessor signatures model.
  for (const p of cls.properties) {
    emitJsDoc(lines, `${p.access === "r" ? "[read-only]" : ""} ${p.description ?? ""}`);
    const tsType = mapTypeToTs(p.type, knownClasses);
    lines.push(`  ${tsAccessor(p.name)}(): ${tsType};`);
  }

  // Elements: child collections. Type is the *element-of* class wrapped in
  // `JxaCollection<T>` so the JXA element-query API (`byId`, `whose`, `at`)
  // is exposed to `// @ts-check` consumers — see the JxaCollection comment
  // at the top of this file. A plain `T[]` would lose those methods even
  // though they exist at runtime.
  for (const e of cls.elements) {
    const tsType = mapTypeToTs(e.type, knownClasses);
    // Plural — JXA convention: `flattenedTasks()`, `tags()`, etc.
    // The sdef element name is singular; pluralization is mechanical.
    const plural = pluralizeAccessor(e.type);
    lines.push(`  /** child collection of '${e.type}' */`);
    lines.push(`  ${plural}(): JxaCollection<${tsType}>;`);
  }

  lines.push(`}`);
  return lines.join("\n");
}

function pluralizeAccessor(sdefSingular: string): string {
  const base = tsAccessor(sdefSingular);
  // English-specific plural rules tuned for the OF lexicon. Falls back to
  // "+s". The .sdef has no real irregulars in the OmniFocus suite as of
  // OF 4.x.
  if (base.endsWith("s") || base.endsWith("x") || base.endsWith("ch") || base.endsWith("sh")) {
    return `${base}es`;
  }
  if (base.endsWith("y") && !/[aeiou]y$/.test(base)) {
    return `${base.slice(0, -1)}ies`;
  }
  return `${base}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const xml = readFileSync(SDEF_PATH, "utf8");
  const classes = parseClasses(xml);
  const knownClasses = new Set(classes.map((c) => c.name));

  // Stable order: by .sdef appearance, but sort within for diff-friendliness.
  // Properties and elements stay in .sdef order — they're closer to a
  // semantic ordering (parent-first, etc.) than alphabetical would be.

  const header = [
    `// AUTO-GENERATED by scripts/generate-jxa-types.ts`,
    `// Source: ${SDEF_PATH}`,
    `// Run \`pnpm generate:jxa-types\` to regenerate.`,
    `// To refresh the .sdef snapshot from the live OmniFocus.app, run`,
    `// \`pnpm sync:sdef\` first.`,
    `//`,
    `// Coverage: ${classes.length} classes,`,
    `//           ${classes.reduce((n, c) => n + c.properties.length, 0)} properties,`,
    `//           ${classes.reduce((n, c) => n + c.elements.length, 0)} elements.`,
    "",
  ].join("\n");

  // JxaCollection<T> — the shape every element-collection accessor returns.
  // The sdef declares element relationships (`<element type="task"/>` etc.)
  // but says nothing about the query methods JXA exposes on the returned
  // collection. At runtime `flattenedTasks()` is an array AND has `.byId(id)`,
  // `.whose(filter)`, `.at(idx)` — none of which TypeScript can infer from a
  // plain `T[]` return. This interface lets `// @ts-check` consumers call
  // those methods without surfacing as `TS2339`. Ambient (no `export`) so
  // it joins script-mode scope automatically when the .d.ts is referenced.
  //
  // `whose(filter)` returns a thunk (a function that, when called, yields
  // matching specifiers) — the JXA query API is lazy. `byId` throws (-1728)
  // at the next method call when the id is unknown rather than returning
  // null; callers wrap with the `lookupOrThrow` helper from
  // \`_helpers/lookup_or_throw.js\` to surface that as a structured error
  // (#674 / #687).
  const collectionType = [
    `interface JxaCollection<T> extends Array<T> {`,
    `  /** JXA element-query: fetch a specifier by id. Lazy — throws (-1728) on next access if id is unknown. */`,
    `  byId(id: string): T;`,
    `  /** JXA element-query: filter by sdef-attribute predicate. Returns a thunk; call it to evaluate. */`,
    `  whose(filter: Record<string, unknown>): () => T[];`,
    `  /** JXA element-query: random access. */`,
    `  at(idx: number): T;`,
    `}`,
    "",
  ].join("\n");

  const body = classes.map((c) => emitClass(c, knownClasses)).join("\n\n");

  const out = `${header}\n${collectionType}\n${body}\n`;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, out);

  process.stdout.write(
    `Wrote ${OUT_PATH}: ${classes.length} classes / ${classes.reduce(
      (n, c) => n + c.properties.length,
      0,
    )} properties / ${classes.reduce((n, c) => n + c.elements.length, 0)} elements\n`,
  );
}

main();
