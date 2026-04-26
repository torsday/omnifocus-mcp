/**
 * Script inliner — makes `src/scripts/**\/*.js` imports evaluate to a
 * string of the file's raw contents at both build time (esbuild, for the
 * production bundle) and test time (vite/vitest, for integration tests).
 *
 * When any bundled or test-loaded code does:
 *   import pingScript from './scripts/jxa/ping.js'
 *
 * the loader intercepts the import and returns the raw file content as
 * the default export instead of evaluating the JS file as a module. JXA
 * and OmniJS scripts define a top-level `function run(argv)` without any
 * exports, so evaluating them as an ES module yields `undefined` — which
 * is exactly how integration tests broke silently before this loader was
 * wired into vitest (see issue #276).
 *
 * Keeping scripts as first-class editable source files (ADR-0005) while
 * making the dist bundle self-contained — the server never needs to
 * locate script files on disk at runtime.
 *
 * @see docs/adr/0005-scripts-as-first-class-files.md
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from "esbuild";

/** Matches any path that resolves under `src/scripts/`. */
const SCRIPTS_RE = /[/\\]src[/\\]scripts[/\\].+\.js$/;

/** Read a script file and wrap its contents as a default string export. */
function scriptAsDefaultExport(path: string): string {
  const source = readFileSync(path, "utf8");
  return `export default ${JSON.stringify(source)};`;
}

/**
 * Return an esbuild plugin that converts `src/scripts/**\/*.js` imports into
 * string-returning modules. Used by `tsup` during `pnpm build`.
 */
export function scriptInlinerPlugin(): Plugin {
  return {
    name: "omnifocus-script-inliner",
    setup(build: PluginBuild) {
      // Intercept all .js files under src/scripts/.
      build.onLoad(
        { filter: SCRIPTS_RE },
        (args: OnLoadArgs): OnLoadResult => ({
          contents: scriptAsDefaultExport(resolve(args.path)),
          loader: "js",
        }),
      );
    },
  };
}

/**
 * Vite-compatible plugin with the same semantics as {@link scriptInlinerPlugin}.
 * Used by vitest so integration tests import the script sources as strings,
 * matching the production build behaviour. Returning a plain object
 * (typed `unknown`) avoids adding `vite` as a direct dependency — vitest
 * already bundles a compatible plugin API.
 */
export function scriptInlinerVitePlugin(): {
  name: string;
  enforce: "pre";
  load(id: string): string | null;
} {
  return {
    name: "omnifocus-script-inliner",
    enforce: "pre",
    load(id: string): string | null {
      // Strip any query string vite may append (e.g. ?used).
      const cleanId = id.split("?", 1)[0] ?? id;
      if (!SCRIPTS_RE.test(cleanId)) return null;
      return scriptAsDefaultExport(resolve(cleanId));
    },
  };
}
