import { defineConfig } from "tsup";
import { scriptInlinerPlugin } from "./src/scripts/scriptLoader.js";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  bundle: true,
  splitting: false,
  treeshake: true,
  sourcemap: false,
  minify: true,
  clean: true,
  dts: false,
  shims: false,
  esbuildPlugins: [scriptInlinerPlugin()],
});
