import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptInlinerPlugin } from "./scriptLoader.js";

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
