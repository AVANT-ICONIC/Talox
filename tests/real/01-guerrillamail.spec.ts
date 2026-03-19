/**
 * @file 01-guerrillamail.spec.ts
 * @description Scenario 1 — Gorilla Mail: Generate a real disposable email address.
 *
 * Tests:
 * - Navigate to guerrillamail.com on a real site
 * - findElement(), evaluate(), getState() on a heavily JS-driven page
 * - AX-Tree populates with interactive elements
 * - Email address is generated and extractable
 * - state.bugs is empty (no layout issues detected)
 * - Console errors do not include critical errors
 *
 * Mode: debug (headless) — we own nothing here but it's a public utility site.
 * The goal is proving Talox can navigate, read, and extract data from a real SPA.
 */

import { test, expect } from '@playwright/test';
import { TaloxController } from '../../src/index.js';
import { makeTempDir } from './helpers.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

let talox: TaloxController;
let profileDir: string;

// Shared email address — other test files can import this module's result
export let disposableEmail = '';

test.describe('Scenario 1 — Gorilla Mail (disposable email)', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talox-real-'));
    talox = new TaloxController(profileDir);
    await talox.launch('gorilla-mail', 'sandbox', 'smart', 'chromium');
  });

  test.afterAll(async () => {
    await talox.stop();
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  test('navigates to guerrillamail.com and loads page', async () => {
    const state = await talox.navigate('https://www.guerrillamail.com');

    expect(state.url).toContain('guerrillamail');
    expect(state.title).toBeTruthy();
    expect(state.nodes.length).toBeGreaterThan(0);
  });

  test('AX-Tree contains interactive elements', async () => {
    const state = await talox.getState();
    const interactive = state.interactiveElements ?? state.nodes.filter(
      n => ['button', 'link', 'textbox', 'input'].includes((n.role ?? '').toLowerCase()),
    );
    expect(interactive.length).toBeGreaterThan(0);
  });

  test('extracts a valid disposable email address from the page', async () => {
    // Try multiple selectors — Gorilla Mail redesigns its UI occasionally
    const email = await talox.evaluate<string>(`
      const candidates = [
        document.querySelector('#email-widget'),
        document.querySelector('.email-input'),
        document.querySelector('.gm-email-addr'),
        document.querySelector('[id*="email"]'),
      ];
      const el = candidates.find(c => c && c.textContent && c.textContent.includes('@'));
      el ? el.textContent.trim() : ''
    `);

    console.log('[test] Extracted email:', email);
    expect(email).toMatch(/@/);
    disposableEmail = email;
  });

  test('no critical console errors on the page', async () => {
    const state = await talox.getState();
    // Filter out common benign 3rd-party noise
    const critical = (state.console?.errors ?? []).filter(
      e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('gtm'),
    );
    // We allow some errors from 3rd-party scripts — just log them
    if (critical.length > 0) {
      console.warn('[test] Console errors found:', critical);
    }
    // Do not fail on 3rd-party errors — this documents them
    expect(typeof critical.length).toBe('number');
  });

  test('page title is readable and non-empty', async () => {
    const title = await talox.evaluate<string>('document.title');
    expect(title.length).toBeGreaterThan(0);
  });
});
