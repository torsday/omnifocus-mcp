import { defineConfig } from "tsup";
import { scriptInlinerPlugin } from "./src/scripts/scriptLoader.js";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  bundle: true,
  splitting: false,
  treeshake: true,
  sourcemap: false,
  minify: false,
  clean: true,
  dts: false,
  shims: false,
  esbuildPlugins: [scriptInlinerPlugin()],
});
