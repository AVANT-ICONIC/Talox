/**
 * Stealth Detection Test
 *
 * Runs Talox in adaptive mode against known bot-detection fingerprinting sites
 * and captures what signals are exposed. Compare screenshots against a plain
 * Playwright session to verify the Biomechanical Ghost Engine + stealth plugin
 * are doing their job.
 *
 * Sites tested:
 * - bot.sannysoft.com   — WebDriver flag, user agent, canvas, WebGL, plugins
 * - fingerprint.com/demo — commercial fingerprinting (FingerprintJS Pro)
 * - abrahamjuliot.github.io/creepjs — deep browser fingerprint analysis
 */

import { TaloxController } from '../src/index.js';

const SITES = [
  { name: 'sannysoft',     url: 'https://bot.sannysoft.com' },
  { name: 'fingerprintjs', url: 'https://fingerprint.com/demo' },
  { name: 'creepjs',       url: 'https://abrahamjuliot.github.io/creepjs' },
];

const talox = new TaloxController('./test-profiles');
await talox.launch('stealth-test', 'sandbox', 'adaptive');

for (const site of SITES) {
  console.log(`\n── ${site.name}: ${site.url}`);

  const state = await talox.navigate(site.url);

  // Let JS fingerprinting scripts finish
  await talox.waitForTimeout(4000);

  // Screenshot for visual inspection
  await talox.screenshot({ path: `./test-profiles/${site.name}.png` });

  // Check console for detection signals
  if (state.console.errors.length) {
    console.log('  Console errors:', state.console.errors);
  }

  // Scan AX-tree for detection result text
  const signals = state.nodes.filter(n =>
    /bot|detected|pass|fail|webdriver|automation/i.test(n.name ?? '')
  );
  if (signals.length) {
    console.log('  Detection signals in AX-tree:');
    signals.forEach(n => console.log(`    [${n.role}] ${n.name}`));
  } else {
    console.log('  No detection signals in AX-tree ✓');
  }

  // Human-readable page summary
  const description = await talox.describePage();
  console.log('  Page summary:', description.slice(0, 200));

  console.log(`  Bugs: ${state.bugs.length} | Network failures: ${state.network.failedRequests.length}`);
  console.log(`  Screenshot: test-profiles/${site.name}.png`);
}

await talox.stop();
console.log('\nDone.');
