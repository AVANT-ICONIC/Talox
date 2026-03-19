// playwright.config.ts
import { defineConfig } from '@playwright/test';

const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir:  './tests/real',
  timeout:  120_000,
  retries:  IS_CI ? 1 : 0,

  // Real-world tests are inherently sequential to avoid rate limits and
  // shared IP bans. Run with a single worker.
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    // Trace and video on failure for debugging real-world test outcomes
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  // No fixture server — tests run against real websites
});
