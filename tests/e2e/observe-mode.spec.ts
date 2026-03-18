// tests/e2e/observe-mode.spec.ts
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { TaloxController } from '../../dist/index.js';
import type { AnnotationAddedEvent, SessionEndEvent } from '../../dist/types/events.js';

const BASE     = 'http://localhost:9999';
const PROFILES = path.join(process.cwd(), 'tests', 'temp-profiles');
const IS_CI    = !!process.env.CI;

function hasEsbuild(): boolean {
  try {
    require.resolve('esbuild');
    return true;
  } catch {
    return false;
  }
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'talox-observe-'));
}

test.describe('Surface 2 — Observe Mode', () => {
  let talox: TaloxController;
  let outputDir: string;

  test.beforeEach(async () => {
    outputDir = makeTempDir();
    talox = new TaloxController(PROFILES);
    await talox.launch('e2e-observe', 'sandbox', 'observe', 'chromium', {
      output: 'both',
      outputDir,
    });
  });

  test.afterEach(async () => {
    await talox.stop().catch(() => {});
    // Clean up temp dir
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  // ── Overlay injection ────────────────────────────────────────────────────────

  test('window.__talox__ is defined after navigation', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();
    const taloxObj = await page.evaluate(() => (window as any).__talox__);
    expect(taloxObj).toBeDefined();
    expect(typeof taloxObj.sessionId).toBe('string');
  });

  test('window.__talox__.sessionId is a non-empty string', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();
    const sessionId = await page.evaluate(() => (window as any).__talox__?.sessionId);
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);
  });

  test('overlay persists after SPA-style navigation', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    await talox.navigate(`${BASE}/form.html`);
    const page = talox.getPlaywrightPage();
    const taloxObj = await page.evaluate(() => (window as any).__talox__);
    expect(taloxObj).toBeDefined();
  });

  // ── Context menu ─────────────────────────────────────────────────────────────

  test('right-click shows #talox-context-menu', async () => {
    test.skip(IS_CI || !hasEsbuild(), 'Context menu requires headed browser and esbuild overlay (install esbuild to enable)');

    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();
    await page.click('h1', { button: 'right' });

    const menu = await page.waitForSelector('#talox-context-menu', { timeout: 3000 });
    expect(menu).not.toBeNull();
  });

  // ── CDP bridge ───────────────────────────────────────────────────────────────

  test('__taloxEmit__ is a function exposed on window', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();
    const isFunction = await page.evaluate(
      () => typeof (window as any).__taloxEmit__ === 'function'
    );
    expect(isFunction).toBe(true);
  });

  test('calling __taloxEmit__ annotation:add fires annotationAdded event', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();

    const received: AnnotationAddedEvent[] = [];
    talox.on('annotationAdded', (e) => received.push(e));

    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:add', {
        id: 'test-uuid-1',
        interactionIndex: 0,
        timestamp: new Date().toISOString(),
        labels: ['bug'],
        comment: 'This button label is confusing',
        element: {
          tag: 'button',
          role: 'button',
          selector: '#primary-action',
          boundingBox: { x: 100, y: 200, width: 120, height: 40 },
        },
      });
    });

    // Give the bridge a tick to process
    await new Promise(r => setTimeout(r, 100));

    expect(received.length).toBe(1);
    expect(received[0]!.entry.comment).toBe('This button label is confusing');
    expect(received[0]!.bufferSize).toBe(1);
  });

  // ── Undo ─────────────────────────────────────────────────────────────────────

  test('annotation:undo fires annotationUndone and decrements buffer', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();

    // First add an annotation
    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:add', {
        id: 'test-uuid-2',
        interactionIndex: 0,
        timestamp: new Date().toISOString(),
        labels: ['note'],
        comment: 'Good UX here',
        element: {
          tag: 'button',
          selector: '#secondary-action',
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        },
      });
    });
    await new Promise(r => setTimeout(r, 100));

    const undone: any[] = [];
    talox.on('annotationUndone', (e) => undone.push(e));

    // Now undo it
    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:undo', {});
    });
    await new Promise(r => setTimeout(r, 100));

    expect(undone.length).toBe(1);
    expect(undone[0]!.bufferSize).toBe(0);
  });

  test('undo on empty buffer is a safe no-op', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);
    const page = talox.getPlaywrightPage();

    const undone: any[] = [];
    talox.on('annotationUndone', (e) => undone.push(e));

    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:undo', {});
    });
    await new Promise(r => setTimeout(r, 100));

    // No annotation existed — event should NOT fire
    expect(undone.length).toBe(0);
  });

  // ── Session report ───────────────────────────────────────────────────────────

  test('browser close writes session report to outputDir', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);

    // Add one annotation via bridge
    const page = talox.getPlaywrightPage();
    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:add', {
        id: 'report-test-uuid',
        interactionIndex: 0,
        timestamp: new Date().toISOString(),
        labels: ['improvement'],
        comment: 'Report test annotation',
        element: {
          tag: 'h1',
          selector: 'h1',
          boundingBox: { x: 0, y: 0, width: 300, height: 60 },
        },
      });
    });

    const sessionEndEvents: SessionEndEvent[] = [];
    talox.on('sessionEnd', (e) => sessionEndEvents.push(e));

    // Stop the session (triggers finalize + file write)
    await talox.stop();
    await new Promise(r => setTimeout(r, 1200)); // give reporter time to flush

    const files = fs.readdirSync(outputDir);
    const jsonFile = files.find(f => f.endsWith('.json'));
    const mdFile   = files.find(f => f.endsWith('.md'));

    expect(jsonFile).toBeDefined();
    expect(mdFile).toBeDefined();
  });

  test('session report JSON is valid and contains annotations', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);

    const page = talox.getPlaywrightPage();
    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:add', {
        id: 'json-report-test',
        interactionIndex: 0,
        timestamp: new Date().toISOString(),
        labels: ['bug'],
        comment: 'JSON report annotation',
        element: {
          tag: 'button',
          selector: '#primary-action',
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        },
      });
    });

    await talox.stop();
    await new Promise(r => setTimeout(r, 1200));

    const files = fs.readdirSync(outputDir);
    const jsonFile = files.find(f => f.endsWith('.json'))!;
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFile), 'utf8'));

    expect(report.annotations).toBeDefined();
    expect(Array.isArray(report.annotations)).toBe(true);
    expect(report.annotations.length).toBeGreaterThanOrEqual(1);
    expect(report.annotations[0].comment).toBe('JSON report annotation');
  });

  test('session report Markdown contains annotations table', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);

    const page = talox.getPlaywrightPage();
    await page.evaluate(() => {
      (window as any).__taloxEmit__('annotation:add', {
        id: 'md-report-test',
        interactionIndex: 0,
        timestamp: new Date().toISOString(),
        labels: ['note'],
        comment: 'Markdown report annotation',
        element: {
          tag: 'nav',
          selector: 'nav',
          boundingBox: { x: 0, y: 0, width: 400, height: 50 },
        },
      });
    });

    await talox.stop();
    await new Promise(r => setTimeout(r, 1200));

    const files = fs.readdirSync(outputDir);
    const mdFile = files.find(f => f.endsWith('.md'))!;
    const md = fs.readFileSync(path.join(outputDir, mdFile), 'utf8');

    expect(md).toContain('Markdown report annotation');
    expect(md).toContain('## Annotations');
  });

  test('sessionEnd event fires with correct counts', async () => {
    await talox.navigate(`${BASE}/observe-target.html`);

    const events: SessionEndEvent[] = [];
    talox.on('sessionEnd', (e) => events.push(e));

    await talox.stop();
    await new Promise(r => setTimeout(r, 1200));

    expect(events.length).toBe(1);
    expect(typeof events[0]!.sessionId).toBe('string');
    expect(typeof events[0]!.durationMs).toBe('number');
  });
});
