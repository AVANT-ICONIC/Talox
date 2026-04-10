import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser integration tests: need real Chromium
    include: [
      'tests/core/**/*.test.ts',
    ],
    testTimeout: 180_000, // 3 min — CI Chromium launch is slow
    hookTimeout: 180_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/unit/**',
      '**/tests/e2e/**',
      '**/tests/real/**',
      '**/examples/**/*.test.ts',
    ],
  },
});
