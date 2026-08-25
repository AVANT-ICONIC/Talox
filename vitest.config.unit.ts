import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests: fast, no browser needed
    include: [
      'tests/unit/**/*.test.ts',
    ],
    // Keep generic BrowserManager unit tests independent of whether the CI host
    // has a desktop session. Dedicated Xvfb tests explicitly unset DISPLAY when
    // they verify Linux virtual-display auto-detection.
    env: {
      DISPLAY: ':99',
    },
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
