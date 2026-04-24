import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Smoke test: verifies built dist/ output is intact
    include: [
      'tests/smoke/**/*.test.ts',
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    exclude: [
      '**/node_modules/**',
      '**/src/**',
      '**/tests/unit/**',
      '**/tests/core/**',
      '**/tests/e2e/**',
      '**/tests/real/**',
      '**/examples/**/*.test.ts',
    ],
  },
});
