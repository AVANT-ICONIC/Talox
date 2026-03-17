/**
 * Stealth Session Example
 *
 * Demonstrates launching Talox in stealth mode to evade bot detection.
 * The Biomechanical Ghost engine handles all mouse/keyboard interactions
 * with human-like timing, Bezier curves, and typo simulation.
 *
 * Use this pattern when:
 * - Interacting with sites that have bot detection
 * - You need persistent authenticated sessions
 * - Human-like behavioral fingerprinting is required
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// Launch with an 'ops' profile (persistent, domain-restricted) in stealth mode
await talox.launch('my-agent', 'ops', 'stealth');

// navigate() returns a TaloxPageState — the full structured JSON contract
const state = await talox.navigate('https://example.com');

console.log('URL:', state.url);
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Bugs detected:', state.bugs.length);

// Click by selector — HumanMouse handles the trajectory automatically
await talox.click({ selector: 'a[href="/about"]' });

// Type with realistic keystroke timing and optional typo simulation
await talox.type({ text: 'hello world', selector: 'input[name="search"]' });

// Get updated state after interaction
const nextState = await talox.getState();
console.log('AX-Tree nodes after interaction:', nextState.nodes.length);

await talox.stop();
