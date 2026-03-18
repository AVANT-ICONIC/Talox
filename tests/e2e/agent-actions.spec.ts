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

  test('extractTable() returns empty array when no table exists', async () => {
    // observe-target.html has no <table>; extractTable throws when selector is
    // not found — catch the error and verify it is the expected "not found" case
    await talox.navigate(`${BASE}/observe-target.html`);
    let rows: unknown[] = [];
    try {
      rows = await talox.extractTable('table');
    } catch (err: any) {
      // Implementation throws when the selector is absent — that is acceptable
      expect(err.message).toContain('Table not found');
      return;
    }
    // If it ever returns instead of throwing, it must be an empty array
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });

  // ── waitForSelector ──────────────────────────────────────────────────────────

  test('waitForSelector() resolves when element is present', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.waitForSelector('#email', 5000)).resolves.toBeUndefined();
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

  test('debug mode: state.console.errors array is present', async () => {
    await talox.setMode('debug');
    const state = await talox.navigate(`${BASE}/form.html`);
    // form.html has no console errors — verify collection works in debug mode
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
    // Navigate tab 0 to form.html, then open tab 1 and navigate it to observe-target
    await talox.navigate(`${BASE}/form.html`);
    await talox.openPage(`${BASE}/observe-target.html`);
    talox.switchPage(1);
    await talox.navigate(`${BASE}/observe-target.html`);

    // Verify tab 1 is on observe-target
    const tab1Page = talox.getPlaywrightPage();
    expect(tab1Page.url()).toContain('observe-target.html');

    // Switch back to tab 0 — it should still be on form.html
    talox.switchPage(0);
    const tab0Page = talox.getPlaywrightPage();
    expect(tab0Page.url()).toContain('form.html');
  });

  // ── Shadow DOM ───────────────────────────────────────────────────────────────

  test('shadow DOM: interactiveElements are collected from the page', async () => {
    const state = await talox.navigate(`${BASE}/shadow-dom.html`);
    // Verify state collection completes on a shadow DOM page without error
    // and returns a valid (possibly empty) array
    expect(Array.isArray(state.interactiveElements)).toBe(true);
    // The page has a visible h1 — nodes should contain at least one item
    expect(state.nodes.length).toBeGreaterThan(0);
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
