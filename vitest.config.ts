import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/chaos/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: false,
    reporters: ["default"],
    testTimeout: 5000,
    hookTimeout: 5000,
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
