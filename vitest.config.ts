import { defineConfig } from "vitest/config";
import { scriptInlinerVitePlugin } from "./src/scripts/scriptLoader.js";

// Integration tests drive real osascript invocations against live OmniFocus —
// each JXA round trip is ~200–500ms and cleanup hooks may issue several
// deletions serially. The 5s default is fine for unit tests (which run in
// milliseconds) but is routinely too tight for integration. Raise the
// threshold only when OMNIFOCUS_INTEGRATION=1 so unit-test regressions still
// surface as clean timeouts.
const INTEGRATION = process.env.OMNIFOCUS_INTEGRATION === "1";
const PERF = process.env.OMNIFOCUS_PERF === "1";
// Perf suite has long beforeAll (seeding) and individual trials; use a
// generous per-test timeout when OMNIFOCUS_PERF=1.
const TEST_TIMEOUT = PERF ? 120_000 : INTEGRATION ? 30_000 : 5_000;
const HOOK_TIMEOUT = PERF ? 120_000 : INTEGRATION ? 30_000 : 5_000;

// Auto-detect non-interactive environments (agent shells, CI, pipes) and
// switch to a compact reporter. Full verbose output is only useful when a
// human is watching — for agents and CI the summary line per file is enough,
// and failures always show the full stack trace regardless of reporter.
//
// Override with VITEST_REPORTER env var, or use pnpm test:loud / pnpm test:quiet.
//
// Reporter selection:
//   VITEST_REPORTER=verbose  → explicit verbose (override)
//   VITEST_REPORTER=dot      → explicit dot (override)
//   no TTY and no env var    → "dot" (compact)
//   TTY                      → "default" (verbose with watch support)
function resolveReporter(): string {
  if (process.env.VITEST_REPORTER) return process.env.VITEST_REPORTER;
  const isInteractive = process.stdout.isTTY === true && !process.env.CI;
  return isInteractive ? "default" : "dot";
}

export default defineConfig({
  // Vite plugin — inlines `src/scripts/**\/*.js` as default string exports,
  // matching the production build (tsup + scriptInlinerPlugin). Without this,
  // `import taskCreateScript from "../../scripts/jxa/task_create.js"` imports
  // the file as an ES module and gets `undefined`, which silently breaks
  // integration tests (issue #276).
  plugins: [scriptInlinerVitePlugin()],
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/chaos/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/perf/**/*.perf.test.ts",
      "tests/benchmark/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
      "tests/scripts/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: false,
    reporters: [resolveReporter()],
    testTimeout: TEST_TIMEOUT,
    hookTimeout: HOOK_TIMEOUT,
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["dist/**", "**/*.config.ts", "tests/**", "src/scripts/**"],
    },
  },
});
