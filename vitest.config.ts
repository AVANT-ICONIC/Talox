import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/core/**/*.test.ts',
    ],
    // Long timeout to accommodate browser tests in tests/core/
    testTimeout: 120_000,
    hookTimeout: 120_000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/e2e/**',
      '**/tests/real/**',
      '**/examples/**/*.test.ts',
    ],
  },
});
