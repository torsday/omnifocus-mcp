/**
 * esbuild plugin that inlines `src/scripts/**\/*.js` files as string exports.
 *
 * When bundled code does:
 *   import pingScript from './scripts/jxa/ping.js'
 *
 * the plugin intercepts that import and returns the raw file content as a
 * default string export instead of executing the JS file as a module.
 *
 * This keeps JXA and OmniJS scripts as first-class editable source files
 * (ADR-0005) while making the dist bundle self-contained — the server never
 * needs to locate script files on disk at runtime.
 *
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from "esbuild";

/** Matches any path that resolves under `src/scripts/`. */
const SCRIPTS_RE = /[/\\]src[/\\]scripts[/\\].+\.js$/;

/**
 * Return an esbuild plugin that converts `src/scripts/**\/*.js` imports into
 * string-returning modules.
 */
export function scriptInlinerPlugin(): Plugin {
  return {
    name: "omnifocus-script-inliner",
    setup(build: PluginBuild) {
      // Intercept all .js files under src/scripts/.
      build.onLoad({ filter: SCRIPTS_RE }, (args: OnLoadArgs): OnLoadResult => {
        const source = readFileSync(resolve(args.path), "utf8");
        // Emit an ES module whose default export is the raw script source.
        return {
          contents: `export default ${JSON.stringify(source)};`,
          loader: "js",
        };
      });
    },
  };
}
