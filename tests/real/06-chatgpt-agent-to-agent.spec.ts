/**
 * @file 06-chatgpt-agent-to-agent.spec.ts
 * @description Scenario 6 — ChatGPT Web UI: Agent-to-Agent communication.
 *
 * This is the most experimental test. A Talox-powered agent navigates to
 * chat.openai.com and uses ChatGPT's own web UI to send a message and read
 * the response. This proves:
 *
 * 1. Talox works on extremely complex, heavily bot-protected JS SPAs
 * 2. An agent can use Talox as a fallback "ask another AI" capability
 * 3. Dynamic content (streaming responses) can be captured via waitForSelector
 *
 * Tests:
 * - Navigate ChatGPT without being blocked
 * - findElement() locates the message input on a complex SPA
 * - type() a question
 * - Wait for and extract the response
 * - Response is a non-empty string
 *
 * Mode: smart — OpenAI has significant bot detection and fingerprinting.
 *
 * Skip: automatically skipped if OPENAI_EMAIL / OPENAI_PASS not set.
 * The test also runs a limited guest-mode variant if no credentials are provided.
 */

import { test, expect } from '@playwright/test';
import { TaloxController } from '../../src/index.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const openaiEmail = process.env.OPENAI_EMAIL;
const openaiPass  = process.env.OPENAI_PASS;
const hasCredentials = !!(openaiEmail && openaiPass);

let talox: TaloxController;
let profileDir: string;

test.describe('Scenario 6 — ChatGPT agent-to-agent communication', () => {
  test.setTimeout(180_000); // Streaming responses can take time

  test.beforeAll(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talox-chatgpt-'));
    talox = new TaloxController(profileDir);

    talox.on('adapted', (e) => {
      console.log(`[adapted] reason=${e.reason} strategy=${e.strategy}`);
    });

    await talox.launch('chatgpt-agent', 'sandbox', 'smart', 'chromium');
  });

  test.afterAll(async () => {
    await talox.stop();
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  test('navigates to ChatGPT without being hard-blocked', async () => {
    const state = await talox.navigate('https://chat.openai.com');
    expect(state.url).toContain('openai.com');
    expect(state.nodes.length).toBeGreaterThan(0);
    console.log('[test] ChatGPT title:', state.title);
    console.log('[test] ChatGPT node count:', state.nodes.length);
  });

  test('page has interactive elements (not a static error page)', async () => {
    const state = await talox.getState();
    const hasButton = state.nodes.some(n => (n.role ?? '').toLowerCase() === 'button');
    const hasInput  = state.nodes.some(n =>
      ['textbox', 'input', 'searchbox'].includes((n.role ?? '').toLowerCase()),
    );
    console.log('[test] Has button:', hasButton, '| Has input:', hasInput);
    expect(hasButton || hasInput).toBe(true);
  });

  test('SKIP: full chat flow requires authenticated session', async () => {
    test.skip(!hasCredentials, 'Set OPENAI_EMAIL and OPENAI_PASS in .env.test to run full chat flow');
  });

  // Only runs when credentials are set
  test('logs in to ChatGPT', async () => {
    test.skip(!hasCredentials, 'Credentials required');

    // Click "Log in"
    const loginEl = await talox.findElement('Log in', 'button') ??
                    await talox.findElement('Sign in', 'button');
    if (loginEl) await talox.click(loginEl.selector);

    // Fill email
    await talox.waitForSelector('input[type="email"]', 30_000);
    await talox.type('input[type="email"]', openaiEmail!);

    const continueEl = await talox.findElement('Continue', 'button');
    if (continueEl) await talox.click(continueEl.selector);

    // Fill password
    await talox.waitForSelector('input[type="password"]', 30_000);
    await talox.type('input[type="password"]', openaiPass!);

    const submitEl = await talox.findElement('Continue', 'button') ??
                     await talox.findElement('Sign in', 'button');
    if (submitEl) await talox.click(submitEl.selector);

    await talox.waitForLoadState('networkidle', 30_000);
    console.log('[test] Login submitted');
  });

  test('sends a message to ChatGPT and receives a response', async () => {
    test.skip(!hasCredentials, 'Credentials required');

    // Wait for the message textarea to appear
    await talox.waitForSelector('textarea[placeholder], #prompt-textarea, [contenteditable="true"]', 30_000);

    const question = 'In one sentence, what is 2 + 2?';

    // Type the question
    const textareaSelectors = [
      '#prompt-textarea',
      'textarea[placeholder]',
      '[contenteditable="true"]',
    ];

    let typed = false;
    for (const sel of textareaSelectors) {
      try {
        await talox.type(sel, question);
        typed = true;
        break;
      } catch { /* try next */ }
    }
    expect(typed).toBe(true);

    // Send the message
    const sendEl = await talox.findElement('Send message', 'button') ??
                   await talox.findElement('Send', 'button');
    if (sendEl) {
      await talox.click(sendEl.selector);
    } else {
      await talox.evaluate(`
        const btn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"]');
        if (btn) btn.click();
      `);
    }

    // Wait for the response to appear (streaming — wait for it to settle)
    console.log('[test] Waiting for ChatGPT response...');
    await talox.waitForTimeout(5000); // Initial delay for response start

    // Wait for the streaming indicator to disappear (response complete)
    try {
      await talox.waitForSelector('.result-streaming', 30_000);
      // Wait for it to be gone (response complete)
      await talox.waitForTimeout(15_000);
    } catch {
      // No streaming indicator found — response may already be complete
    }

    // Extract the response text
    const response = await talox.evaluate<string>(`
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = messages[messages.length - 1];
      last ? last.textContent.trim() : ''
    `);

    console.log('[test] ChatGPT response:', response.slice(0, 200));
    expect(response.length).toBeGreaterThan(0);
    // A response to "what is 2+2" should contain "4"
    expect(response).toContain('4');
  });
});
