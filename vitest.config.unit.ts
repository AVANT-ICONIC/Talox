import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests: fast, no browser needed
    include: [
      'tests/unit/**/*.test.ts',
    ],
    testTimeout: 5_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/cli/**'],
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/core/**',
      '**/tests/e2e/**',
      '**/tests/real/**',
      '**/examples/**/*.test.ts',
    ],
  },
});
