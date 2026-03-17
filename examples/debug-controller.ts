/**
 * Debug Session Example
 *
 * Demonstrates launching Talox in debug mode for maximum observability.
 * Debug mode captures the full AX-Tree, all console output, network failures,
 * layout bugs, and visual diffs — without interfering with agent behavior.
 *
 * Use this pattern when:
 * - Diagnosing why an agent action failed
 * - Verifying page state before/after an interaction
 * - Running visual regression checks
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// 'qa' profile gives full perception depth and visual regression support
await talox.launch('debug-agent', 'qa', 'debug');

const state = await talox.navigate('https://example.com');

// Console output — errors, warnings, and logs are all captured
console.log('Console errors:', state.console.errors);
console.log('Console warnings:', state.console.warnings);

// Network failures — any 4xx/5xx responses
console.log('Failed requests:', state.network.failedRequests);

// Layout bugs detected by the Rules Engine
if (state.bugs.length > 0) {
  state.bugs.forEach(bug => {
    console.log(`[${bug.severity}] ${bug.type}: ${bug.description}`);
  });
}

// Full AX-Tree is available in debug mode (perceptionDepth: 'full')
console.log('AX-Tree root role:', state.axTree?.role);
console.log('Total nodes:', state.nodes.length);

// Visual regression — compare against a saved baseline
const diff = await talox.verifyVisual({
  baselinePath: './baselines/example-home.png',
  threshold: 0.01, // 1% pixel difference tolerance
});
console.log('Visual match:', diff.ssimScore > 0.99 ? 'PASS' : 'FAIL');
console.log('SSIM score:', diff.ssimScore);

// Switch to stealth for the actual agent action, then back to debug to verify
await talox.setMode('stealth');
await talox.click({ selector: 'a[href="/login"]' });

await talox.setMode('debug');
const postClickState = await talox.getState();
console.log('After click — URL:', postClickState.url);
console.log('After click — bugs:', postClickState.bugs.length);

await talox.stop();
