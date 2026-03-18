/**
 * @file observe-session.ts
 * @description Example: Observe mode — human drives the browser, agent watches.
 *
 * Launch with:
 *   npx ts-node examples/observe-session.ts
 *
 * The browser opens. Browse normally. Right-click anywhere to access the Talox
 * overlay menu. Close the browser when done — the session report is written
 * automatically to ./talox-sessions/
 */

import { TaloxController } from '../src/index.js';

const talox = new TaloxController('./profiles');

// ── Event listeners ───────────────────────────────────────────────────────────

talox.on('navigation', ({ url }) => {
  console.log(`[Talox] → ${url}`);
});

talox.on('consoleError', ({ error, url }) => {
  console.warn(`[Talox] Console error on ${url}:\n  ${error}`);
});

talox.on('annotationAdded', ({ entry, bufferSize }) => {
  const labels = entry.labels.join(', ') || 'unlabelled';
  console.log(
    `[Talox] Annotation #${bufferSize}: [${labels}] "${entry.comment}" ` +
    `on <${entry.element.tag}> "${entry.element.text ?? ''}"`,
  );
});

talox.on('annotationUndone', ({ bufferSize }) => {
  console.log(`[Talox] Last annotation undone. Buffer: ${bufferSize}`);
});

talox.on('sessionEnd', ({ sessionId, reportPath, durationMs, interactionCount, annotationCount }) => {
  const secs = Math.round(durationMs / 1000);
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       Talox Observe Session Complete      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Session ID   : ${sessionId.slice(0, 8)}...`);
  console.log(`║  Duration     : ${secs}s`);
  console.log(`║  Interactions : ${interactionCount}`);
  console.log(`║  Annotations  : ${annotationCount}`);
  console.log(`║  Report       : ${reportPath}`);
  console.log('╚══════════════════════════════════════════╝');
});

// ── Launch ────────────────────────────────────────────────────────────────────

await talox.launch('human-test', 'qa', 'observe', 'chromium', {
  output:    'both',           // generates both JSON and Markdown reports
  outputDir: './talox-sessions',
});

console.log('');
console.log('  🔍 Talox Observe Mode');
console.log('  Browser is open. Browse normally.');
console.log('  Right-click anywhere to access the Talox overlay:');
console.log('    → Comment Mode  — annotate elements');
console.log('    → Snapshot      — capture page state');
console.log('    → End Session   — finalize and write report');
console.log('  Closing the browser also ends the session automatically.');
console.log('');
