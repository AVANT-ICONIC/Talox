/**
 * Minimal Talox agent example.
 * Talox = browser runtime; Not Talox = hosted scraping, cloud search, or generic workflow platforms.
 *
 * Install:
 *   npm install talox
 *   npx playwright install chromium --with-deps
 *
 * Run:
 *   npx tsx examples/minimal-agent.ts
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  settings: { verbosity: 0 },
});

await talox.launch('my-agent', 'ops', 'chromium');

const state = await talox.navigate('https://example.com');

console.log('URL:', state.url);
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Layout bugs detected:', state.bugs.length);

// Interactions use string selectors.
// await talox.click('button[type="submit"]');
// await talox.type('input[name="q"]', 'hello');

const updated = await talox.getState();
console.log('ARIA nodes:', updated.nodes.length);

await talox.stop();
