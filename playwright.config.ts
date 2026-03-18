// playwright.config.ts
import { defineConfig } from '@playwright/test';

const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir:  './tests/e2e',
  timeout:  60_000,
  retries:  IS_CI ? 2 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // Record video and trace only when a test fails — avoids disk bloat on green runs
    video:  'retain-on-failure',
    trace:  'retain-on-failure',
  },

  // Auto-start the fixture server before any test, kill it after
  webServer: {
    command:             'node tests/e2e/fixtures/server.mjs',
    port:                9999,
    reuseExistingServer: !IS_CI,
    timeout:             10_000,
  },
});
