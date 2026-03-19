/**
 * @file helpers.ts
 * @description Shared utilities for real-world Talox tests.
 */

import { TaloxController } from '../../src/index.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

/** Create a temp profile directory that is cleaned up after each test file. */
export function makeTempDir(prefix = 'talox-real-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Load test credentials from .env.test — returns null if not set. */
export function loadCreds(): { redditUser: string; redditPass: string } | null {
  const user = process.env.REDDIT_USER;
  const pass = process.env.REDDIT_PASS;
  if (!user || !pass) return null;
  return { redditUser: user, redditPass: pass };
}

/** Wait for a condition to be truthy, polling every 500ms up to `timeout` ms. */
export async function waitFor(
  fn: () => Promise<boolean>,
  timeout = 30_000,
  interval = 500,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/** Extract a guerrillamail.com disposable address from the page via evaluate. */
export async function extractGuerrillaEmail(talox: TaloxController): Promise<string> {
  // The address is in #email-widget .blur or span#email-widget
  return await talox.evaluate<string>(`
    (document.querySelector('#email-widget') ||
     document.querySelector('.email-input') ||
     document.querySelector('[data-testid="email-address"]') ||
     document.querySelector('.gm-email-addr'))?.textContent?.trim() ?? ''
  `);
}
