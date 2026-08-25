import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/core/**/*.test.ts',
    ],
    // Keep generic browser-manager tests independent of the CI host's lack of a
    // desktop session. Dedicated Xvfb tests explicitly unset DISPLAY when they
    // verify Linux virtual-display auto-detection.
    env: {
      DISPLAY: ':99',
    },
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
