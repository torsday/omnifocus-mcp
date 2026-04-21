import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "tests/integration/**"],
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
