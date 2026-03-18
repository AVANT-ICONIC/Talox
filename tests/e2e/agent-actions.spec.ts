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
    // debug mode: testing our own fixture server — no stealth warmup needed
    await talox.launch('e2e-actions', 'sandbox', 'debug');
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

  // ── Full form interaction flow ───────────────────────────────────────────────

  test('full flow: type email + password → submit → success appears', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.type('#email', 'agent@talox.dev');
    await talox.type('#password', 'SuperSecret123!');
    await talox.click('#submit');
    const page = talox.getPlaywrightPage();
    await page.waitForSelector('#success', { state: 'visible', timeout: 5000 });
    const text = await page.innerText('#success');
    expect(text).toContain('Welcome back');
  });

  test('full flow: contact form fill → submit → sent message appears', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.type('#name', 'Talox Agent');
    await talox.type('#message', 'Hello from the automated agent!');
    const page = talox.getPlaywrightPage();
    await page.click('button[type="submit"]');
    await page.waitForSelector('#sent', { state: 'visible', timeout: 5000 });
    const text = await page.innerText('#sent');
    expect(text).toContain('Message sent');
  });

  test('type() value persists after clicking into another field', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.type('#email', 'persist@talox.dev');
    await talox.click('#password');
    const page = talox.getPlaywrightPage();
    const value = await page.inputValue('#email');
    expect(value).toBe('persist@talox.dev');
  });

  test('type() returns updated page state with correct url', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const state = await talox.type('#email', 'state@talox.dev');
    expect(state.url).toContain('form.html');
    expect(Array.isArray(state.nodes)).toBe(true);
  });

  // ── Click ───────────────────────────────────────────────────────────────────

  test('click() on submit button triggers success div', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.click('#submit');
    const page = talox.getPlaywrightPage();
    const successVisible = await page.isVisible('#success');
    expect(successVisible).toBe(true);
  });

  test('click() returns updated page state', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const state = await talox.click('#submit');
    expect(state.url).toContain('form.html');
    expect(Array.isArray(state.nodes)).toBe(true);
  });

  test('click() on a nav link updates the page url hash', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.click('a[href="#about"]');
    const page = talox.getPlaywrightPage();
    expect(page.url()).toContain('#about');
  });

  // ── Human mouse movement ─────────────────────────────────────────────────────

  test('mouseMove() resolves without error to a coordinate', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.mouseMove(300, 200)).resolves.toBeUndefined();
  });

  test('mouseMove() can traverse the viewport in sequence', async () => {
    await talox.navigate(`${BASE}/form.html`);
    // Simulate human cursor travelling across the page
    await talox.mouseMove(100, 100);
    await talox.mouseMove(400, 300);
    await talox.mouseMove(200, 500);
    const page = talox.getPlaywrightPage();
    // Page must still be responsive after mouse movement
    expect(page.url()).toContain('form.html');
  });

  // ── Human idle behaviours ────────────────────────────────────────────────────

  test('fidget() completes simulated idle movement without error', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.fidget(300)).resolves.toBeUndefined();
  });

  test('think() completes simulated thinking pause without error', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.think(300)).resolves.toBeUndefined();
  });

  // ── Scroll ──────────────────────────────────────────────────────────────────

  test('scrollTo() brings an element into the viewport', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.scrollTo('#primary-action');
    const page = talox.getPlaywrightPage();
    const inViewport = await page.evaluate(() => {
      const el = document.querySelector('#primary-action');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    expect(inViewport).toBe(true);
  });

  test('scrollTo() align:start places element near top of viewport', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.scrollTo('#primary-action', 'start');
    const page = talox.getPlaywrightPage();
    const top = await page.evaluate(() => {
      const el = document.querySelector('#primary-action');
      return el ? el.getBoundingClientRect().top : -1;
    });
    expect(top).toBeGreaterThanOrEqual(0);
  });

  // ── Screenshot ──────────────────────────────────────────────────────────────

  test('screenshot() returns a non-empty Buffer', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const result = await talox.screenshot();
    expect(result).toBeInstanceOf(Buffer);
    expect((result as Buffer).length).toBeGreaterThan(1000);
  });

  test('screenshot() captures element when selector provided', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const result = await talox.screenshot({ selector: '#login-form' });
    expect(result).toBeInstanceOf(Buffer);
    expect((result as Buffer).length).toBeGreaterThan(500);
  });

  // ── evaluate() ───────────────────────────────────────────────────────────────

  test('evaluate() can read the page title from the DOM', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const title = await talox.evaluate<string>('document.title');
    expect(title).toBe('Talox Test — Form');
  });

  test('evaluate() can count elements on the page', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const inputCount = await talox.evaluate<number>(
      'document.querySelectorAll("input").length',
    );
    expect(inputCount).toBeGreaterThanOrEqual(2); // email + password
  });

  test('evaluate() can set a DOM value and read it back', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.evaluate(
      'document.querySelector("#email").value = "eval@talox.dev"',
    );
    const value = await talox.evaluate<string>(
      'document.querySelector("#email").value',
    );
    expect(value).toBe('eval@talox.dev');
  });

  // ── findElement ─────────────────────────────────────────────────────────────

  test('findElement() locates a button by text', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const el = await talox.findElement('Sign In', 'button');
    expect(el).not.toBeNull();
    expect(el!.selector).toBeTruthy();
  });

  test('findElement() returns bounding box with positive dimensions', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const el = await talox.findElement('Sign In', 'button');
    expect(el).not.toBeNull();
    expect(el!.boundingBox.width).toBeGreaterThan(0);
    expect(el!.boundingBox.height).toBeGreaterThan(0);
  });

  test('findElement() returns null for text that does not exist', async () => {
    await talox.navigate(`${BASE}/form.html`);
    const el = await talox.findElement('NonExistentButtonXYZ', 'button');
    expect(el).toBeNull();
  });

  test('findElement() → click() end-to-end semantic flow', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const el = await talox.findElement('Place Order', 'button');
    expect(el).not.toBeNull();
    // Selector returned by findElement must be directly usable in click()
    const state = await talox.click(el!.selector);
    expect(state.url).toContain('observe-target.html');
  });

  // ── extractTable ─────────────────────────────────────────────────────────────

  test('extractTable() returns empty array when no table exists', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    let rows: unknown[] = [];
    try {
      rows = await talox.extractTable('table');
    } catch (err: any) {
      expect(err.message).toContain('Table not found');
      return;
    }
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });

  // ── waitForSelector ──────────────────────────────────────────────────────────

  test('waitForSelector() resolves when element is present', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await expect(talox.waitForSelector('#email', 5000)).resolves.toBeUndefined();
  });

  test('waitForSelector() resolves for a dynamically shown element', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.click('#submit');
    // #success is shown by JS after click — must be present within 3s
    await expect(
      talox.waitForSelector('#success', 3000),
    ).resolves.toBeUndefined();
  });

  // ── Mode presets ─────────────────────────────────────────────────────────────

  test('speed mode: navigation completes without warmup delay', async () => {
    await talox.setMode('speed');
    const start = Date.now();
    await talox.navigate(`${BASE}/form.html`);
    const elapsed = Date.now() - start;
    // Speed mode skips the 2000ms+ smart-mode warmup + 500ms settle.
    // PageStateCollector DOM scan takes ~3–4s regardless of mode.
    // Smart mode totals ~8–9s; speed mode must be meaningfully faster.
    expect(elapsed).toBeLessThan(8000);
  });

  test('debug mode: state.console.errors array is present', async () => {
    await talox.setMode('debug');
    const state = await talox.navigate(`${BASE}/form.html`);
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
    await talox.openPage(`${BASE}/observe-target.html`);
    talox.switchPage(1);
    await talox.navigate(`${BASE}/observe-target.html`);

    const tab1Page = talox.getPlaywrightPage();
    expect(tab1Page.url()).toContain('observe-target.html');

    talox.switchPage(0);
    const tab0Page = talox.getPlaywrightPage();
    expect(tab0Page.url()).toContain('form.html');
  });

  test('closePage() removes the tab from the pool', async () => {
    await talox.navigate(`${BASE}/form.html`);
    await talox.openPage(`${BASE}/observe-target.html`);
    expect(talox.getPageCount()).toBe(2);
    await talox.closePage(1);
    expect(talox.getPageCount()).toBe(1);
  });

  // ── Shadow DOM ───────────────────────────────────────────────────────────────

  test('shadow DOM: interactiveElements are collected from the page', async () => {
    const state = await talox.navigate(`${BASE}/shadow-dom.html`);
    expect(Array.isArray(state.interactiveElements)).toBe(true);
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

  test('getElementsInFrame() returns nodes scoped to the attention frame', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.setAttentionFrame('main');
    const elements = await talox.getElementsInFrame();
    expect(Array.isArray(elements)).toBe(true);
    expect(elements.length).toBeGreaterThan(0);
    talox.clearAttentionFrame();
  });

  test('clearAttentionFrame() removes frame scope for subsequent actions', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.setAttentionFrame('main');
    talox.clearAttentionFrame();
    // After clearing, findElement should still work on the full page
    const el = await talox.findElement('Place Order', 'button');
    expect(el).not.toBeNull();
  });
});
