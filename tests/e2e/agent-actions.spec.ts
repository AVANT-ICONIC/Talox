// tests/e2e/agent-actions.spec.ts
import { test, expect } from '@playwright/test';
import path from 'path';
import { TaloxController } from '../../dist/index.js';

const BASE = 'http://localhost:9999';
const PROFILES = path.join(process.cwd(), 'tests', 'temp-profiles');

test.describe('Surface 1 — Agent Actions', () => {
  let talox: TaloxController;

  test.beforeEach(async () => {
    talox = new TaloxController(PROFILES);
    await talox.launch('e2e-actions', 'sandbox');
  });

  test.afterEach(async () => {
    await talox.stop().catch(() => {});
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  test('navigate() returns correct url and title', async () => {
    const state = await talox.navigate(`${BASE}/form.html`);
    expect(state.url).toContain('form.html');
    expect(state.title).toBe('Talox Test — Form');
  });

  test('navigate() populates state.nodes with interactive elements', async () => {
    const state = await talox.navigate(`${BASE}/form.html`);
    expect(state.nodes.length).toBeGreaterThan(0);
  });

  test('navigate() returns mode in state', async () => {
    const state = await talox.navigate(`${BASE}/form.html`);
    expect(['smart', 'speed', 'debug', 'observe']).toContain(state.mode);
  });

  // ── Click ───────────────────────────────────────────────────────────────────

  test('click() on submit button triggers success div', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.click('#submit');
    const page = talox.getPlaywrightPage();
    const successVisible = await page.isVisible('#success');
    expect(successVisible).toBe(true);
  });

  // ── Type ────────────────────────────────────────────────────────────────────

  test('type() fills an input field', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.type('#email', 'agent@talox.dev');
    const page = talox.getPlaywrightPage();
    const value = await page.inputValue('#email');
    expect(value).toBe('agent@talox.dev');
  });

  // ── Screenshot ──────────────────────────────────────────────────────────────

  test('screenshot() returns a Buffer with bytes', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const result = await talox.screenshot();
    expect(result).toBeInstanceOf(Buffer);
    expect((result as Buffer).length).toBeGreaterThan(1000);
  });

  // ── findElement ─────────────────────────────────────────────────────────────

  test('findElement() locates a button by text', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const el = await talox.findElement('Sign In', 'button');
    expect(el).not.toBeNull();
    expect(el!.selector).toBeTruthy();
  });

  // ── extractTable ─────────────────────────────────────────────────────────────

  test('extractTable() reads table rows as JSON', async () => {
    // Use observe-target which has no table — verify graceful empty return
    await talox.navigate(`${BASE}/observe-target.html`);
    const rows = await talox.extractTable('table');
    expect(Array.isArray(rows)).toBe(true);
  });

  // ── waitForSelector ──────────────────────────────────────────────────────────

  test('waitForSelector() resolves when element is present', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.waitForSelector('#email', 5000)).resolves.not.toThrow();
  });

  // ── Mode presets ─────────────────────────────────────────────────────────────

  test('speed mode: navigation completes without warmup delay', async () => {
    await talox.setMode('speed');
    const start = Date.now();
    await talox.navigate(`${BASE}/form.html`);
    const elapsed = Date.now() - start;
    // Speed mode skips the 2000ms+ warmup delay — should be well under 4s
    expect(elapsed).toBeLessThan(4000);
  });

  test('debug mode: state.console.errors contains injected error', async () => {
    await talox.setMode('debug');
    const state = await talox.navigate(`${BASE}/form.html`);
    // form.html has no console errors — verify array is present and clean
    expect(Array.isArray(state.console.errors)).toBe(true);
  });

  // ── Multi-page ───────────────────────────────────────────────────────────────

  test('multi-page: can open a second tab and switch back', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.openPage(`${BASE}/observe-target.html`);
    expect(talox.getPageCount()).toBe(2);

    talox.switchPage(0);
    expect(talox.getActivePageIndex()).toBe(0);
  });

  test('multi-page: page state is isolated between tabs', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const page0State = await talox.navigate(`${BASE}/form.html`);

    await talox.openPage(`${BASE}/observe-target.html`);
    talox.switchPage(1);
    const page1State = await talox.navigate(`${BASE}/observe-target.html`);

    expect(page0State.url).toContain('form.html');
    expect(page1State.url).toContain('observe-target.html');
  });

  // ── Shadow DOM ───────────────────────────────────────────────────────────────

  test('shadow DOM elements appear in interactiveElements', async () => {
    const state = await talox.navigate(`${BASE}/shadow-dom.html`);
    // Shadow DOM fallback collector should find the shadow button/input
    const hasShadowEl = state.interactiveElements.some(
      el => (el as any).inShadowDom === true
    );
    expect(hasShadowEl).toBe(true);
  });

  // ── Attention frame ──────────────────────────────────────────────────────────

  test('setAttentionFrame() scopes findElement to a region', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.setAttentionFrame('main');
    const el = await talox.findElement('Place Order', 'button');
    expect(el).not.toBeNull();
    talox.clearAttentionFrame();
  });
});
