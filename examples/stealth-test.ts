/**
 * Stealth Detection Test
 *
 * Runs Talox with explicit high-stealth settings against known browser
 * fingerprinting sites and records observable detection signals.
 */

import { TaloxController } from 'talox';

const SITES = [
  { name: 'sannysoft', url: 'https://bot.sannysoft.com' },
  { name: 'fingerprintjs', url: 'https://fingerprint.com/demo' },
  { name: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs' },
];

const talox = new TaloxController('./test-profiles', {
  settings: {
    stealthLevel: 'high',
    adaptiveStealthEnabled: true,
    humanStealth: 1,
    navigationWaitUntil: 'domcontentloaded',
  },
});

await talox.launch('stealth-test', 'sandbox', 'chromium');

for (const site of SITES) {
  console.log(`\n── ${site.name}: ${site.url}`);

  const state = await talox.navigate(site.url);

  await talox.waitForTimeout(4000);
  await talox.screenshot({ path: `./test-profiles/${site.name}.png` });

  if (state.console.errors.length) {
    console.log('  Console errors:', state.console.errors);
  }

  const signals = state.nodes.filter((node) =>
    /bot|detected|pass|fail|webdriver|automation/i.test(node.name ?? ''),
  );
  if (signals.length) {
    console.log('  Detection signals in ARIA state:');
    signals.forEach((node) => console.log(`    [${node.role}] ${node.name}`));
  } else {
    console.log('  No detection signals in ARIA state ✓');
  }

  const description = await talox.describePage();
  console.log('  Page summary:', description.slice(0, 200));

  console.log(`  Bugs: ${state.bugs.length} | Network failures: ${state.network.failedRequests.length}`);
  console.log(`  Screenshot: test-profiles/${site.name}.png`);
}

await talox.stop();
console.log('\nDone.');
