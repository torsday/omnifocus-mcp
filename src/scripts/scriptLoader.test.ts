import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandInlineDirectives, scriptInlinerPlugin } from "./scriptLoader.js";

/**
 * Simulates what esbuild calls when it encounters a matching import.
 * We call the onLoad handler directly with a fixture path.
 */
async function invokePlugin(filePath: string) {
  const plugin = scriptInlinerPlugin();

  // Collect registered onLoad handlers
  const handlers: Array<{
    filter: RegExp;
    fn: (args: { path: string }) => { contents: string; loader: string } | undefined;
  }> = [];

  const fakeBuild = {
    onLoad(
      options: { filter: RegExp },
      fn: (args: { path: string }) => { contents: string; loader: string },
    ) {
      handlers.push({ filter: options.filter, fn });
    },
  };

  plugin.setup(fakeBuild as never);

  for (const { filter, fn } of handlers) {
    if (filter.test(filePath)) {
      return fn({ path: filePath });
    }
  }
  return undefined;
}

describe("scriptInlinerPlugin", () => {
  const jxaPingPath = resolve("src/scripts/jxa/ping.js");
  const omniJsPingPath = resolve("src/scripts/omnijs/ping.js");

  it("returns contents for a JXA script path", async () => {
    const result = await invokePlugin(jxaPingPath);
    expect(result).toBeDefined();
    expect(result?.loader).toBe("js");
  });

  it("exports the file contents as a default string export for JXA", async () => {
    const result = await invokePlugin(jxaPingPath);
    const rawSource = readFileSync(jxaPingPath, "utf8");
    expect(result?.contents).toBe(`export default ${JSON.stringify(rawSource)};`);
  });

  it("exported string contains the original script source for JXA", async () => {
    const result = await invokePlugin(jxaPingPath);
    const rawSource = readFileSync(jxaPingPath, "utf8");
    // Unwrap the JSON.stringify wrapper to verify round-trip
    const match = result?.contents.match(/^export default ([\s\S]+);$/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse((match as RegExpMatchArray)[1] as string);
    expect(decoded).toBe(rawSource);
  });

  it("returns contents for an OmniJS script path", async () => {
    const result = await invokePlugin(omniJsPingPath);
    expect(result).toBeDefined();
    expect(result?.loader).toBe("js");
  });

  it("exports the file contents as a default string export for OmniJS", async () => {
    const result = await invokePlugin(omniJsPingPath);
    const rawSource = readFileSync(omniJsPingPath, "utf8");
    expect(result?.contents).toBe(`export default ${JSON.stringify(rawSource)};`);
  });

  it("does not intercept paths outside src/scripts/", async () => {
    const result = await invokePlugin(resolve("src/index.ts"));
    expect(result).toBeUndefined();
  });

  it("returns the plugin name 'omnifocus-script-inliner'", () => {
    const plugin = scriptInlinerPlugin();
    expect(plugin.name).toBe("omnifocus-script-inliner");
  });
});

/**
 * @inline directive expansion (ADR-0020). Helpers live alongside consumers
 * under `_helpers/` and are spliced into the consumer's source by the
 * loader before it is wrapped as the bundled string.
 */
describe("expandInlineDirectives — @inline directive expansion", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "script-inliner-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns source unchanged when no directives are present", () => {
    const source = "function run(argv) { return JSON.stringify({ ok: true }); }\n";
    const result = expandInlineDirectives(source, tempDir);
    expect(result).toBe(source);
  });

  it("replaces a single directive with the helper file contents", () => {
    mkdirSync(join(tempDir, "_helpers"));
    writeFileSync(
      join(tempDir, "_helpers", "build_task.js"),
      "function buildTask(t) { return t.id(); }\n",
    );

    const source =
      "// @inline _helpers/build_task.js\n\nfunction run(argv) { return buildTask(argv[0]); }\n";
    const result = expandInlineDirectives(source, tempDir);
    expect(result).toContain("function buildTask(t) { return t.id(); }");
    expect(result).not.toContain("// @inline");
    expect(result).toContain("function run(argv) { return buildTask(argv[0]); }");
  });

  it("replaces multiple directives in document order", () => {
    mkdirSync(join(tempDir, "_helpers"));
    writeFileSync(join(tempDir, "_helpers", "a.js"), "/*A*/");
    writeFileSync(join(tempDir, "_helpers", "b.js"), "/*B*/");

    const source = "// @inline _helpers/a.js\n// @inline _helpers/b.js\n";
    const result = expandInlineDirectives(source, tempDir);
    const aIdx = result.indexOf("/*A*/");
    const bIdx = result.indexOf("/*B*/");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it("ignores directives that are not on their own line", () => {
    // Mid-line comments are intentionally not directives — only top-of-line.
    const source = "function run() { /* // @inline _helpers/x.js */ }\n";
    const result = expandInlineDirectives(source, tempDir);
    expect(result).toBe(source);
  });

  it("does not recurse into nested @inline directives in helpers", () => {
    // Per ADR-0020, expansion is single-level; a helper containing @inline
    // is a non-feature. Verify the directive in the helper is preserved
    // verbatim (not expanded), so a future change to recursive expansion
    // would have to update this assertion deliberately.
    mkdirSync(join(tempDir, "_helpers"));
    writeFileSync(
      join(tempDir, "_helpers", "outer.js"),
      "// @inline _helpers/inner.js\nfunction outer() {}\n",
    );
    writeFileSync(join(tempDir, "_helpers", "inner.js"), "function inner() {}\n");

    const source = "// @inline _helpers/outer.js\n";
    const result = expandInlineDirectives(source, tempDir);
    expect(result).toContain("function outer()");
    expect(result).not.toContain("function inner()");
    expect(result).toContain("// @inline _helpers/inner.js");
  });

  it("resolves directive paths relative to the consumer's directory", () => {
    const consumerDir = join(tempDir, "scripts", "jxa");
    mkdirSync(consumerDir, { recursive: true });
    mkdirSync(join(consumerDir, "_helpers"));
    writeFileSync(join(consumerDir, "_helpers", "h.js"), "/*HELPER*/");

    const source = "// @inline _helpers/h.js\n";
    const result = expandInlineDirectives(source, consumerDir);
    expect(result).toContain("/*HELPER*/");
  });

  it("throws a clear error when a directive references a missing file", () => {
    const source = "// @inline _helpers/does_not_exist.js\n";
    expect(() => expandInlineDirectives(source, tempDir)).toThrow(/ENOENT|no such file/);
  });
});

/**
 * Integration: scriptInlinerPlugin uses expandInlineDirectives. Verify the
 * full path on a fixture script that uses @inline so esbuild and Vite paths
 * stay byte-equivalent to a hand-pasted helper.
 */
describe("scriptInlinerPlugin × @inline integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "script-inliner-integ-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("expands @inline before wrapping as default string export", async () => {
    const scriptsDir = join(tempDir, "src", "scripts", "jxa");
    mkdirSync(join(scriptsDir, "_helpers"), { recursive: true });
    writeFileSync(
      join(scriptsDir, "_helpers", "build_task.js"),
      "function buildTask(t) { return t.id(); }\n",
    );

    const consumerSource =
      "// @inline _helpers/build_task.js\nfunction run(argv) { return buildTask(argv[0]); }\n";
    const consumerPath = join(scriptsDir, "task_get.js");
    writeFileSync(consumerPath, consumerSource);

    const result = await invokePlugin(consumerPath);
    expect(result).toBeDefined();
    expect(result?.loader).toBe("js");

    const match = result?.contents.match(/^export default ([\s\S]+);$/);
    expect(match).not.toBeNull();
    const decoded = JSON.parse((match as RegExpMatchArray)[1] as string);
    expect(decoded).toContain("function buildTask(t) { return t.id(); }");
    expect(decoded).toContain("function run(argv) { return buildTask(argv[0]); }");
    expect(decoded).not.toContain("// @inline");
  });
});
