/**
 * QA Flow Example
 *
 * Demonstrates using Talox as a QA agent to detect layout bugs, JS errors,
 * and visual regressions on a page. Uses the built-in Rules Engine and
 * structured page-state contract.
 *
 * Run with: npx vitest examples/qa-flow.test.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TaloxController } from 'talox';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QA Flow', () => {
  it('detects bugs on a page and generates structured state', async () => {
    const talox = new TaloxController(path.join(__dirname, '../tests/temp-profiles'), {
      settings: {
        verbosity: 3,
        safeMode: true,
      },
    });

    try {
      await talox.launch('qa-agent', 'qa', 'chromium');

      const pageUrl = `file://${path.resolve(__dirname, '../tests/manual/buggy.html')}`;
      const state = await talox.navigate(pageUrl);

      console.log(`Detected ${state.bugs.length} bugs:`);
      state.bugs.forEach((bug) => {
        console.log(`  [${bug.severity}] ${bug.type} — ${bug.description}`);
      });

      expect(state.bugs).toBeDefined();
      expect(Array.isArray(state.bugs)).toBe(true);
      expect(state.url).toBeTruthy();
      expect(state.nodes).toBeDefined();
      expect(state.interactiveElements).toBeDefined();
      expect(state.console.errors).toBeDefined();
      expect(state.network.failedRequests).toBeDefined();
    } finally {
      await talox.stop();
    }
  }, 60_000);
});
