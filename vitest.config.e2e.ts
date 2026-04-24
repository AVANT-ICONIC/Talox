import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/e2e/**/*.e2e.test.ts',
    ],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Run sequentially — browser launches are expensive
    fileParallelism: false,
    pool: 'forks',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/unit/**',
      '**/tests/core/**',
      '**/tests/real/**',
      '**/examples/**/*.test.ts',
    ],
  },
});
