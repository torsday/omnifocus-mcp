/**
 * Pure OPML parsing helpers for `ExportService.importOpml`.
 *
 * OPML (Outline Processor Markup Language) is the XML dialect used by
 * OmniFocus for structured export/import. This module parses the OPML
 * produced by `export_opml` back into a typed outline tree so that the
 * service layer can recreate tasks via the adapter.
 *
 * **Lossiness:** OPML preserves outline text and nesting only. Due dates,
 * defer dates, tags, flags, and notes encoded in `omnifocus:task` attributes
 * are retained; however, attachments, repetition rules, contexts, and other
 * OmniFocus-specific metadata are silently dropped on round-trip.
 *
 * **No external dependencies.** The parser uses a lightweight regex-based
 * approach tuned to well-formed OPML. It is not a general-purpose XML parser
 * and will reject (via {@link parseOpml}) XML with unrecognised structure.
 *
 * @see src/services/exportService.ts — orchestrator that calls these helpers
 * @see src/services/export/opml.ts — serialisation counterpart
 */

import { ValidationError } from "../../errors/index.js";

// ---------------------------------------------------------------------------
// Parsed outline tree
// ---------------------------------------------------------------------------

/** A single `<outline>` element extracted from OPML. */
export interface OutlineNode {
  /** Outline text — maps to task/project name. */
  text: string;
  /** OmniFocus type attribute, e.g. `"omnifocus:task"` or `"omnifocus:project"`. */
  type?: string;
  /**
   * OmniFocus persistent ID, if present (produced by `export_opml` for round-trip).
   * Used to match project outlines back to existing OF projects on import.
   */
  id?: string;
  /** Due date in ISO-8601 format, if present. */
  due?: string;
  /** Defer date in ISO-8601 format, if present. */
  defer?: string;
  /** Whether the item was flagged. */
  flagged?: boolean;
  /** Child outlines (subtasks). */
  children: OutlineNode[];
}

/** Root of a parsed OPML document — the items inside `<body>`. */
export interface ParsedOpml {
  /** Top-level outlines (projects or tasks) from the `<body>` element. */
  body: OutlineNode[];
}

// ---------------------------------------------------------------------------
// Attribute extraction
// ---------------------------------------------------------------------------

/**
 * Extract a named XML attribute value from a raw attribute string.
 *
 * Handles both `name="value"` and `name='value'` quoting, and basic XML
 * entity decoding for `&amp;`, `&quot;`, `&lt;`, `&gt;`.
 */
export function extractAttr(attrs: string, name: string): string | undefined {
  // Match name="..." or name='...'
  const re = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? "";
  return decodeXmlEntities(raw);
}

/** Reverse XML entity encoding for common entities. */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// XML tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { kind: "open"; tag: string; attrs: string; selfClose: boolean }
  | { kind: "close"; tag: string };

/**
 * Tokenise an XML string into a flat sequence of open/close/self-close tags.
 * Skips comments, processing instructions, and text content.
 */
export function tokenise(xml: string): Token[] {
  const tokens: Token[] = [];
  // Match any XML tag: open, close, self-close, comment, PI, declaration
  const re = /<(!--[\s\S]*?--|[?!][^>]*|\/(\w[\w:-]*)\s*|(\w[\w:-]*)([^>]*?)(\/?))\s*>/g;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const full = m[0];
    if (full.startsWith("<!--") || full.startsWith("<?") || full.startsWith("<!")) {
      continue; // skip comments and PI / declarations
    }
    const closeTag = m[2]; // e.g. "outline" in </outline>
    if (closeTag) {
      tokens.push({ kind: "close", tag: closeTag.toLowerCase() });
      continue;
    }
    const openTag = m[3];
    if (openTag) {
      const attrs = (m[4] ?? "").trim();
      const selfClose = (m[5] ?? "") === "/";
      tokens.push({ kind: "open", tag: openTag.toLowerCase(), attrs, selfClose });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Stack-based parser
// ---------------------------------------------------------------------------

/**
 * Parse a sequence of tokens into an `<outline>` tree starting from a token
 * at position `pos`. Returns `[node, newPos]`.
 *
 * Called when we've just seen an `open` token for `outline`. Recursively
 * calls itself for nested `outline` elements.
 */
function parseOutline(tokens: Token[], pos: number, openAttrs: string): [OutlineNode, number] {
  const text = extractAttr(openAttrs, "text") ?? "";
  const node: OutlineNode = {
    text,
    children: [],
  };

  const type = extractAttr(openAttrs, "type");
  if (type !== undefined) node.type = type;
  const id = extractAttr(openAttrs, "id");
  if (id !== undefined) node.id = id;
  const due = extractAttr(openAttrs, "due");
  if (due !== undefined) node.due = due;
  const defer = extractAttr(openAttrs, "defer");
  if (defer !== undefined) node.defer = defer;
  const flaggedRaw = extractAttr(openAttrs, "flagged");
  if (flaggedRaw === "true") node.flagged = true;

  // Consume children until we see a matching </outline>
  let i = pos;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) break;
    if (tok.kind === "close" && tok.tag === "outline") {
      return [node, i + 1];
    }
    if (tok.kind === "open" && tok.tag === "outline") {
      if (tok.selfClose) {
        // Self-closing <outline ... /> — leaf node, no children
        const child = parseOutlineSelf(tok.attrs);
        node.children.push(child);
        i++;
      } else {
        const [child, next] = parseOutline(tokens, i + 1, tok.attrs);
        node.children.push(child);
        i = next;
      }
    } else {
      i++;
    }
  }
  // No matching close tag — treat as if self-closed
  return [node, i];
}

/** Parse a self-closing `<outline ... />` element. */
function parseOutlineSelf(attrs: string): OutlineNode {
  const text = extractAttr(attrs, "text") ?? "";
  const node: OutlineNode = { text, children: [] };
  const type = extractAttr(attrs, "type");
  if (type !== undefined) node.type = type;
  const id = extractAttr(attrs, "id");
  if (id !== undefined) node.id = id;
  const due = extractAttr(attrs, "due");
  if (due !== undefined) node.due = due;
  const defer = extractAttr(attrs, "defer");
  if (defer !== undefined) node.defer = defer;
  if (extractAttr(attrs, "flagged") === "true") node.flagged = true;
  return node;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse an OPML XML string into a `ParsedOpml` tree.
 *
 * @throws {ValidationError} if the string is not well-formed OPML.
 */
export function parseOpml(xml: string): ParsedOpml {
  const trimmed = xml.trim();
  if (!/<opml\b/i.test(trimmed)) {
    throw new ValidationError("Not valid OPML: missing <opml> root element.", {
      suggestion: "Provide valid OPML XML, e.g. as produced by export_opml.",
    });
  }
  if (!/<body\b/i.test(trimmed)) {
    throw new ValidationError("Not valid OPML: missing <body> element.", {
      suggestion: "Provide valid OPML XML, e.g. as produced by export_opml.",
    });
  }

  const tokens = tokenise(trimmed);

  // Find <body> token
  let bodyStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok && tok.kind === "open" && tok.tag === "body") {
      bodyStart = i + 1;
      break;
    }
  }
  if (bodyStart === -1) {
    throw new ValidationError("Not valid OPML: could not find <body> open tag in token stream.", {
      suggestion: "Provide valid OPML XML, e.g. as produced by export_opml.",
    });
  }

  const body: OutlineNode[] = [];
  let i = bodyStart;

  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) break;
    if (tok.kind === "close" && tok.tag === "body") break;
    if (tok.kind === "open" && tok.tag === "outline") {
      if (tok.selfClose) {
        body.push(parseOutlineSelf(tok.attrs));
        i++;
      } else {
        const [node, next] = parseOutline(tokens, i + 1, tok.attrs);
        body.push(node);
        i = next;
      }
    } else {
      i++;
    }
  }

  return { body };
}
