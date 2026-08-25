/**
 * @file observe-session.ts
 * @description Example: human-driven observe session with structured reporting.
 *
 * Launch with:
 *   npx tsx examples/observe-session.ts
 *
 * The browser opens. Browse normally. Right-click anywhere to access the Talox
 * overlay menu. Close the browser when done; the session report is written to
 * ./talox-sessions/.
 */

import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  observe: true,
  settings: {
    headed: true,
    verbosity: 2,
    humanTakeoverEnabled: true,
  },
});

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

await talox.launch('human-test', 'qa', 'chromium', {
  headed: true,
  overlay: true,
  record: true,
  output: 'both',
  outputDir: './talox-sessions',
});

console.log('');
console.log('  🔍 Talox Observe Session');
console.log('  Browser is open. Browse normally.');
console.log('  Right-click anywhere to access the Talox overlay:');
console.log('    → Comment Mode  — annotate elements');
console.log('    → Snapshot      — capture page state');
console.log('    → End Session   — finalize and write report');
console.log('  Closing the browser also ends the session automatically.');
console.log('');
