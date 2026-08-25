/**
 * Adaptive Session Example
 *
 * Demonstrates Talox's modern settings-first model for resilient,
 * human-paced interaction on real-world web UIs. The interaction engine
 * handles mouse/keyboard timing, curved movement, and adaptive stealth.
 *
 * Use this pattern when:
 * - Interacting with complex or fragile real-world interfaces
 * - You need persistent authenticated sessions with behavioral consistency
 * - Low-noise, human-paced interaction is required for reliable automation
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  settings: {
    adaptiveStealthEnabled: true,
    stealthLevel: 'high',
    humanStealth: 1,
    navigationWaitUntil: 'domcontentloaded',
  },
});

// The third launch argument is the browser engine, not a Talox mode.
await talox.launch('my-agent', 'ops', 'chromium');

// navigate() returns the full TaloxPageState contract.
const state = await talox.navigate('https://example.com');

console.log('URL:', state.url);
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Bugs detected:', state.bugs.length);

// Example Domain contains a normal link, so this remains a runnable interaction.
await talox.click('a');

// Type uses the same string-selector API when a page contains an input:
// await talox.type('input[name="search"]', 'hello world');

const nextState = await talox.getState('agent');
console.log('Current URL after interaction:', nextState.url);

await talox.stop();
