/**
 * Unit tests for the lightweight OPML parser.
 *
 * Goldilocks coverage: happy paths, edge cases for attribute extraction,
 * self-closing vs. nested elements, and the public `parseOpml` entry point.
 */

import { describe, expect, it } from "vitest";
import { decodeXmlEntities, extractAttr, parseOpml, tokenise } from "./opmlParser.js";

// ---------------------------------------------------------------------------
// extractAttr
// ---------------------------------------------------------------------------

describe("extractAttr", () => {
  it("extracts a double-quoted attribute", () => {
    expect(extractAttr('text="hello world"', "text")).toBe("hello world");
  });

  it("extracts a single-quoted attribute", () => {
    expect(extractAttr("text='hello'", "text")).toBe("hello");
  });

  it("returns undefined for a missing attribute", () => {
    expect(extractAttr('type="task"', "text")).toBeUndefined();
  });

  it("decodes XML entities in attribute values", () => {
    expect(extractAttr('text="AT&amp;T"', "text")).toBe("AT&T");
    expect(extractAttr('text="&lt;tag&gt;"', "text")).toBe("<tag>");
    expect(extractAttr('text="say &quot;hello&quot;"', "text")).toBe('say "hello"');
  });

  it("is case-insensitive for the attribute name", () => {
    expect(extractAttr('TEXT="val"', "text")).toBe("val");
  });
});

// ---------------------------------------------------------------------------
// decodeXmlEntities
// ---------------------------------------------------------------------------

describe("decodeXmlEntities", () => {
  it("decodes all four standard entities", () => {
    expect(decodeXmlEntities("&amp;&quot;&lt;&gt;")).toBe('&"<>');
  });

  it("returns plain strings unchanged", () => {
    expect(decodeXmlEntities("hello")).toBe("hello");
  });

  it("decodes the whitespace character references xmlAttr emits", () => {
    expect(decodeXmlEntities("a&#10;b&#13;c&#9;d")).toBe("a\nb\rc\td");
  });

  it("keeps double-escaped sequences literal (&amp;#10;)", () => {
    expect(decodeXmlEntities("a&amp;#10;b")).toBe("a&#10;b");
  });
});

// ---------------------------------------------------------------------------
// tokenise
// ---------------------------------------------------------------------------

describe("tokenise", () => {
  it("produces open and close tokens", () => {
    const tokens = tokenise("<body><outline text='hi' /></body>");
    expect(tokens).toEqual([
      { kind: "open", tag: "body", attrs: "", selfClose: false },
      { kind: "open", tag: "outline", attrs: "text='hi'", selfClose: true },
      { kind: "close", tag: "body" },
    ]);
  });

  it("skips XML declarations and comments", () => {
    const tokens = tokenise('<?xml version="1.0"?><!-- comment --><body></body>');
    expect(tokens).toEqual([
      { kind: "open", tag: "body", attrs: "", selfClose: false },
      { kind: "close", tag: "body" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// parseOpml
// ---------------------------------------------------------------------------

describe("parseOpml", () => {
  const MINIMAL_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body></body>
</opml>`;

  it("parses a minimal OPML document with empty body", () => {
    const result = parseOpml(MINIMAL_OPML);
    expect(result.body).toHaveLength(0);
  });

  it("throws for non-OPML input", () => {
    expect(() => parseOpml("<html></html>")).toThrow("missing <opml>");
  });

  it("throws for OPML without <body>", () => {
    expect(() => parseOpml('<opml version="2.0"><head/></opml>')).toThrow("missing <body>");
  });

  it("parses a self-closing outline", () => {
    const opml = `<opml><body>
      <outline text="Buy milk" type="omnifocus:task" />
    </body></opml>`;
    const result = parseOpml(opml);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]?.text).toBe("Buy milk");
    expect(result.body[0]?.type).toBe("omnifocus:task");
    expect(result.body[0]?.children).toHaveLength(0);
  });

  it("parses a nested outline (parent with children)", () => {
    const opml = `<opml><body>
      <outline text="Work" type="omnifocus:project">
        <outline text="Task A" type="omnifocus:task" />
        <outline text="Task B" type="omnifocus:task" />
      </outline>
    </body></opml>`;
    const result = parseOpml(opml);
    expect(result.body).toHaveLength(1);
    const project = result.body[0];
    expect(project?.text).toBe("Work");
    expect(project?.children).toHaveLength(2);
    expect(project?.children[0]?.text).toBe("Task A");
    expect(project?.children[1]?.text).toBe("Task B");
  });

  it("captures id, due, defer, and flagged attributes", () => {
    const opml = `<opml><body>
      <outline text="Task" type="omnifocus:task" id="abc123"
               due="2026-05-01T00:00:00Z" defer="2026-04-25T00:00:00Z"
               flagged="true" />
    </body></opml>`;
    const result = parseOpml(opml);
    const node = result.body[0];
    expect(node?.id).toBe("abc123");
    expect(node?.due).toBe("2026-05-01T00:00:00Z");
    expect(node?.defer).toBe("2026-04-25T00:00:00Z");
    expect(node?.flagged).toBe(true);
  });

  it("parses multi-level nesting", () => {
    const opml = `<opml><body>
      <outline text="Project">
        <outline text="Parent task">
          <outline text="Child task" />
        </outline>
      </outline>
    </body></opml>`;
    const result = parseOpml(opml);
    const child = result.body[0]?.children[0]?.children[0];
    expect(child?.text).toBe("Child task");
  });

  it("handles XML entities in text attributes", () => {
    const opml = `<opml><body>
      <outline text="AT&amp;T &lt;brief&gt;" />
    </body></opml>`;
    const result = parseOpml(opml);
    expect(result.body[0]?.text).toBe("AT&T <brief>");
  });
});
