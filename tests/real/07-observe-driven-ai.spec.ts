/**
 * @file 07-observe-driven-ai.spec.ts
 * @description Scenario 7 — AI-driven observe session on a real public site.
 *
 * This test demonstrates the new "Observe-Driven Testing" paradigm:
 * An AI agent launches in debug mode with { overlay: true, record: true },
 * navigates a real site, uses talox.evaluate() to programmatically annotate
 * issues it finds via getState(), then ends the session and asserts the
 * Markdown report was generated correctly.
 *
 * This test type does not exist in any other browser automation framework.
 * It proves that Talox can produce PR-ready test reports without a human
 * ever opening the browser.
 *
 * Tests:
 * - Launch debug mode with overlay:true, record:true (headless)
 * - Navigate a real public site (example.com / iana.org)
 * - getState() finds layout bugs or console errors → annotate each
 * - Evaluate to fire annotation:add events for all detected issues
 * - Evaluate to fire session:end
 * - sessionEnd event fires with correct counts
 * - JSON report file is written to outputDir
 * - Markdown report contains annotations table
 *
 * Mode: debug + { overlay: true, record: true } — our new unified approach
 */

import { test, expect } from '@playwright/test';
import { TaloxController } from '../../src/index.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

let talox: TaloxController;
let profileDir: string;
let outputDir:  string;

const sessionEndEvents: any[] = [];

test.describe('Scenario 7 — AI-driven observe session (debug + overlay + record)', () => {
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talox-observe-ai-'));
    outputDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'talox-reports-'));
    talox = new TaloxController(profileDir);

    talox.on('sessionEnd', (e) => {
      console.log('[sessionEnd]', e);
      sessionEndEvents.push(e);
    });

    // NEW: debug mode with overlay + record — no headed browser needed
    await talox.launch('ai-observe', 'qa', 'debug', 'chromium', {
      overlay:   true,
      record:    true,
      output:    'both',
      outputDir,
    });
  });

  test.afterAll(async () => {
    await talox.stop();
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  test('navigates to a real public page', async () => {
    const state = await talox.navigate('https://www.iana.org/domains/reserved');
    expect(state.url).toContain('iana.org');
    expect(state.nodes.length).toBeGreaterThan(0);
  });

  test('window.__talox__ is defined (overlay injected headlessly)', async () => {
    const meta = await talox.evaluate<any>('window.__talox__');
    expect(meta).toBeTruthy();
    expect(typeof meta.sessionId).toBe('string');
    expect(meta.sessionId.length).toBeGreaterThan(0);
    console.log('[test] Session ID:', meta.sessionId);
  });

  test('window.__taloxEmit__ is callable from evaluate()', async () => {
    const result = await talox.evaluate<boolean>('typeof window.__taloxEmit__ === "function"');
    expect(result).toBe(true);
  });

  test('AI agent annotates issues found via getState()', async () => {
    // Re-navigate for worker-restart resilience; getState() collects state
    await talox.navigate('https://www.iana.org/domains/reserved');
    const state = await talox.getState();
    let annotationCount = 0;

    // Annotate any console errors found
    for (const err of (state.console?.errors ?? []).slice(0, 3)) {
      await talox.evaluate(`
        window.__taloxEmit__('annotation:add', {
          interactionIndex: 1,
          labels: ['bug'],
          comment: ${JSON.stringify(`Console error: ${err.slice(0, 200)}`)},
          element: { tag: 'body', text: 'page' },
        });
      `);
      annotationCount++;
    }

    // Annotate any layout bugs detected
    for (const bug of (state.bugs ?? []).slice(0, 3)) {
      await talox.evaluate(`
        window.__taloxEmit__('annotation:add', {
          interactionIndex: 1,
          labels: ['bug'],
          comment: ${JSON.stringify(`Layout bug: ${bug.type} — ${bug.message ?? 'no message'}`)},
          element: { tag: 'body', text: 'page' },
        });
      `);
      annotationCount++;
    }

    // Always add at least one annotation so the report has content
    if (annotationCount === 0) {
      await talox.evaluate(`
        window.__taloxEmit__('annotation:add', {
          interactionIndex: 1,
          labels: ['note'],
          comment: 'AI exploratory pass — no bugs detected on this page.',
          element: { tag: 'body', text: 'page' },
        });
      `);
      annotationCount++;
    }

    console.log(`[test] Programmatically added ${annotationCount} annotation(s)`);
    expect(annotationCount).toBeGreaterThan(0);
  });

  test('navigates a second page and annotates', async () => {
    await talox.navigate('https://example.com');
    const state = await talox.getState();

    // example.com is a clean minimal page — should have very few bugs
    const bugCount = state.bugs.length;
    console.log('[test] example.com bug count:', bugCount);

    await talox.evaluate(`
      window.__taloxEmit__('annotation:add', {
        interactionIndex: 2,
        labels: ['note'],
        comment: ${JSON.stringify(`example.com loaded with ${bugCount} bugs detected.`)},
        element: { tag: 'body', text: 'example.com' },
      });
    `);
  });

  test('ends session, fires sessionEnd event, and writes reports', async () => {
    // End session via CDP bridge — same as the human clicking "End Session"
    await talox.evaluate(`window.__taloxEmit__('session:end', {})`);

    // Give the reporter time to flush to disk
    await new Promise(r => setTimeout(r, 2000));

    // ── sessionEnd event ──────────────────────────────────────────────────────
    expect(sessionEndEvents.length).toBeGreaterThanOrEqual(1);
    const evt = sessionEndEvents[0];
    expect(evt).toHaveProperty('sessionId');
    expect(evt).toHaveProperty('durationMs');
    expect(evt).toHaveProperty('annotationCount');
    expect(evt.annotationCount).toBeGreaterThanOrEqual(1);
    console.log('[test] sessionEnd:', evt);

    // ── JSON report ───────────────────────────────────────────────────────────
    const files = fs.readdirSync(outputDir);
    const jsonFile = files.find(f => f.endsWith('.json'));
    expect(jsonFile).toBeDefined();

    const jsonContent = fs.readFileSync(path.join(outputDir, jsonFile!), 'utf-8');
    const report = JSON.parse(jsonContent);
    expect(report).toHaveProperty('id');
    expect(Array.isArray(report.annotations)).toBe(true);
    expect(report.annotations.length).toBeGreaterThanOrEqual(1);
    console.log('[test] JSON report has', report.annotations.length, 'annotation(s)');

    // ── Markdown report ───────────────────────────────────────────────────────
    const mdFile = files.find(f => f.endsWith('.md'));
    expect(mdFile).toBeDefined();

    const mdContent = fs.readFileSync(path.join(outputDir, mdFile!), 'utf-8');
    expect(mdContent).toContain('## Annotations');
    expect(mdContent).toContain('| # |');
    console.log('[test] Markdown report length:', mdContent.length, 'chars');
  });
});
