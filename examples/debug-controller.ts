/**
 * Debug Session Example
 *
 * Demonstrates maximum runtime observability with the current settings-first
 * Talox API. Verbosity is explicit; there is no runtime setMode() contract.
 *
 * Use this pattern when:
 * - Diagnosing why an agent action failed
 * - Verifying page state before/after an interaction
 * - Running visual regression checks
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  settings: {
    verbosity: 3,
    navigationWaitUntil: 'domcontentloaded',
  },
});

await talox.launch('debug-agent', 'qa', 'chromium');

const state = await talox.navigate('https://example.com');

console.log('Console errors:', state.console.errors);
console.log('Console warnings:', state.console.warnings);
console.log('Failed requests:', state.network.failedRequests);

if (state.bugs.length > 0) {
  state.bugs.forEach((bug) => {
    console.log(`[${bug.severity}] ${bug.type}: ${bug.description}`);
  });
}

console.log('ARIA root role:', state.axTree?.role);
console.log('Total nodes:', state.nodes.length);

// autoSave=true creates the baseline when it does not exist yet.
const diff = await talox.verifyVisual('example-home', true);
console.log('Visual match:', diff.isMatch ? 'PASS' : 'DIFF');
console.log('SSIM score:', diff.ssimScore);

// Runtime diagnostics are controlled explicitly rather than by mode switching.
talox.setVerbosity(2);
await talox.click('a');

const postClickState = await talox.getState('debug');
console.log('After click — URL:', postClickState.url);
console.log('After click — bugs:', postClickState.bugs.length);

await talox.stop();
