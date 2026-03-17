/**
 * QA Flow Example
 *
 * Demonstrates using Talox as a QA agent to detect layout bugs, JS errors,
 * and visual regressions on a page. Uses the built-in Rules Engine and
 * VisionGate to generate structured bug reports.
 *
 * Run with: npx vitest examples/qa-flow.test.ts
 */

import { describe, it, expect } from 'vitest';
import { TaloxController } from 'talox';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('QA Flow', () => {
  it('detects bugs on a page and generates a report', async () => {
    const talox = new TaloxController(path.join(__dirname, '../tests/temp-profiles'));

    try {
      // 'qa' profile + 'debug' mode = maximum perception
      await talox.launch('qa-agent', 'qa', 'debug');

      // Navigate to the local buggy test page
      const pageUrl = `file://${path.resolve(__dirname, '../tests/manual/buggy.html')}`;
      const state = await talox.navigate(pageUrl);

      console.log(`Detected ${state.bugs.length} bugs:`);
      state.bugs.forEach(bug => {
        console.log(`  [${bug.severity}] ${bug.type} — ${bug.description}`);
      });

      // Verify the Rules Engine is working
      expect(state.bugs).toBeDefined();
      expect(Array.isArray(state.bugs)).toBe(true);

      // Verify the page state contract is complete
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
