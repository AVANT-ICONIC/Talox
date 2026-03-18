// tests/e2e/smart-mode.spec.ts
import { test, expect } from '@playwright/test';
import path from 'path';
import { TaloxController } from '../../dist/index.js';
import type { AdaptedEvent } from '../../dist/types/events.js';

const BASE = 'http://localhost:9999';
const PROFILES = path.join(process.cwd(), 'tests', 'temp-profiles');

test.describe('Surface 3 — Smart Mode Adaptation', () => {
  let talox: TaloxController;

  test.beforeEach(async () => {
    talox = new TaloxController(PROFILES);
    await talox.launch('e2e-smart', 'sandbox', 'smart');
  });

  test.afterEach(async () => {
    await talox.stop().catch(() => {});
  });

  // ── CAPTCHA detection ────────────────────────────────────────────────────────

  test('navigating to captcha.html fires adapted with captcha_detected', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.reason).toBe('captcha_detected');
  });

  test('adapted event payload has reason, strategy, from, to', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);

    const evt = events[0]!;
    expect(typeof evt.reason).toBe('string');
    expect(typeof evt.strategy).toBe('string');
    expect(typeof evt.from).toBe('object');
    expect(typeof evt.to).toBe('object');
  });

  test('adapted event: to settings differ from from (patch was applied)', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);

    const evt = events[0]!;
    // At least one setting should change — captcha strategy patches stealthLevel etc.
    const changed = Object.keys(evt.from).some(
      (k) => (evt.from as any)[k] !== (evt.to as any)[k]
    );
    expect(changed).toBe(true);
  });

  // ── Rate limit detection ─────────────────────────────────────────────────────

  test('navigating to rate-limit.html fires adapted with rate_limit', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    // Set up response watcher before navigating — avoids race condition
    const page = talox.getPlaywrightPage()!;
    const responsePromise = page.waitForResponse('**/api/data');
    await talox.navigate(`${BASE}/rate-limit.html`);
    await responsePromise; // guarantees 429 response has been received before assertion

    const reasons = events.map(e => e.reason);
    expect(reasons).toContain('rate_limit');
  });

  // ── Clean page — no false positives ─────────────────────────────────────────

  test('clean page fires no adapted event', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/form.html`);

    expect(events.length).toBe(0);
  });

  // ── Mode guards ──────────────────────────────────────────────────────────────

  test('adapted is NOT emitted in debug mode', async () => {
    await talox.stop();
    talox = new TaloxController(PROFILES);
    await talox.launch('e2e-smart-debug', 'sandbox', 'debug');

    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);

    expect(events.length).toBe(0);
  });

  test('adapted is NOT emitted in speed mode', async () => {
    await talox.stop();
    talox = new TaloxController(PROFILES);
    await talox.launch('e2e-smart-speed', 'sandbox', 'speed');

    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);

    expect(events.length).toBe(0);
  });

  // ── Multiple signals ─────────────────────────────────────────────────────────

  test('two bot signals in sequence produce two adapted events', async () => {
    const events: AdaptedEvent[] = [];
    talox.on('adapted', (e) => events.push(e));

    await talox.navigate(`${BASE}/captcha.html`);
    await talox.navigate(`${BASE}/captcha.html`);

    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  // ── SemanticHealing flag ─────────────────────────────────────────────────────

  test('isSemanticHealingActive() starts false on a clean page', async () => {
    await talox.navigate(`${BASE}/form.html`);
    // @ts-ignore — _adapt is @internal; access is intentional in test context
    expect(talox._adapt.isSemanticHealingActive()).toBe(false);
  });

  test('resetSemanticHealing() clears the flag', async () => {
    // Navigate to captcha to trigger adaptation (which may activate semantic healing)
    await talox.navigate(`${BASE}/captcha.html`);
    // @ts-ignore — _adapt is @internal; access is intentional in test context
    talox._adapt.resetSemanticHealing();
    // @ts-ignore
    expect(talox._adapt.isSemanticHealingActive()).toBe(false);
  });
});
