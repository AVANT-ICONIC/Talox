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

// Launch a persistent browser profile in ops mode
await talox.launch('my-agent', 'ops');

// Navigate — returns a structured JSON state contract
const state = await talox.navigate('https://example.com');

console.log('URL:', state.url);
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Layout bugs detected:', state.bugs.length);

// Interact — HumanMouse handles trajectory, timing, and stealth automatically
// await talox.click('button[type=submit]');
// await talox.type({ selector: 'input[name=q]', text: 'hello' });

// Pull full page state at any time
const updated = await talox.getState();
console.log('AX-Tree nodes:', updated.nodes.length);

await talox.stop();
