/**
 * Adaptive Session Example
 *
 * Demonstrates launching Talox in adaptive mode for resilient, human-paced
 * interaction on real-world web UIs. The Biomechanical Interaction Engine
 * handles all mouse/keyboard interactions with variable timing, Bezier curves,
 * and realistic keystroke cadence.
 *
 * Use this pattern when:
 * - Interacting with complex or fragile real-world interfaces
 * - You need persistent authenticated sessions with behavioral consistency
 * - Low-noise, human-paced interaction is required for reliable automation
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// Launch with an 'ops' profile (persistent, domain-restricted) in adaptive mode
await talox.launch('my-agent', 'ops', 'adaptive');

// navigate() returns a TaloxPageState — the full structured JSON contract
const state = await talox.navigate('https://example.com');

console.log('URL:', state.url);
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Bugs detected:', state.bugs.length);

// Click by selector — HumanMouse handles the trajectory automatically
await talox.click({ selector: 'a[href="/about"]' });

// Type with realistic keystroke timing and variable cadence
await talox.type({ text: 'hello world', selector: 'input[name="search"]' });

// Get updated state after interaction
const nextState = await talox.getState();
console.log('AX-Tree nodes after interaction:', nextState.nodes.length);

await talox.stop();
