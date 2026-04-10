/**
 * Tests for SessionReporter — JSON/MD/HTML report generation.
 * Filesystem operations are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs.promises before importing SessionReporter
const writtenFiles = new Map<string, string>();
const createdDirs = new Set<string>();

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(async (dir: string) => {
      createdDirs.add(dir);
    }),
    writeFile: vi.fn(async (filePath: string, content: string) => {
      writtenFiles.set(filePath, content);
    }),
  },
}));

// Mock path.join to use forward slashes consistently
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    join: (...segments: string[]) => segments.join('/'),
  };
});

import { SessionReporter } from '../../src/core/observe/SessionReporter.js';
import type { TaloxSessionReport, TaloxInteraction } from '../../src/types/session.js';
import type { SessionReportExtras } from '../../src/types/session-report.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeInteraction(overrides: Partial<TaloxInteraction> = {}): TaloxInteraction {
  return {
    index: 1,
    type: 'click',
    timestamp: '2025-04-10T15:30:00.000Z',
    url: 'https://example.com',
    element: {
      tag: 'button',
      role: 'button',
      text: 'Submit',
      selector: 'button#submit',
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
    },
    consoleErrors: [],
    networkFailures: [],
    ...overrides,
  };
}

function makeReport(overrides: Partial<TaloxSessionReport> = {}): TaloxSessionReport {
  return {
    id: 'test-session-001',
    startedAt: '2025-04-10T15:00:00.000Z',
    endedAt: '2025-04-10T15:30:00.000Z',
    durationMs: 1_800_000, // 30 minutes
    startUrl: 'https://example.com',
    interactions: [makeInteraction()],
    annotations: [],
    summary: {
      totalInteractions: 1,
      totalAnnotations: 0,
      totalConsoleErrors: 0,
      totalNetworkFailures: 0,
      annotationsByLabel: {},
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SessionReporter', () => {
  let reporter: SessionReporter;

  beforeEach(() => {
    writtenFiles.clear();
    createdDirs.clear();
    reporter = new SessionReporter('/tmp/talox-test-sessions');
  });

  // ─── Constructor ───────────────────────────────────────────────────────────

  it('can be constructed with a custom output directory', () => {
    const r = new SessionReporter('/custom/path');
    expect(r).toBeInstanceOf(SessionReporter);
  });

  // ─── write() ───────────────────────────────────────────────────────────────

  it('write creates the output directory', async () => {
    const report = makeReport();
    await reporter.write(report);

    expect(createdDirs.size).toBeGreaterThan(0);
  });

  it('write creates a session subdirectory named with session id and timestamp', async () => {
    const report = makeReport();
    await reporter.write(report);

    const dirArray = Array.from(createdDirs);
    const sessionDir = dirArray.find(d => d.includes('test-session-001'));
    expect(sessionDir).toBeTruthy();
  });

  it('write always produces a JSON report file', async () => {
    const report = makeReport();
    const paths = await reporter.write(report);

    expect(paths.json).toBeTruthy();
    expect(writtenFiles.has(paths.json!)).toBe(true);

    const content = writtenFiles.get(paths.json!)!;
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe('test-session-001');
  });

  it('write with format "json" still produces JSON', async () => {
    const report = makeReport();
    const paths = await reporter.write(report, 'json');

    expect(paths.json).toBeTruthy();
    expect(paths.markdown).toBeUndefined();
  });

  it('write with format "both" produces JSON and Markdown', async () => {
    const report = makeReport();
    const paths = await reporter.write(report, 'both');

    expect(paths.json).toBeTruthy();
    expect(paths.markdown).toBeTruthy();
    expect(writtenFiles.has(paths.markdown!)).toBe(true);
  });

  it('write with format "markdown" produces JSON and Markdown', async () => {
    const report = makeReport();
    const paths = await reporter.write(report, 'markdown');

    expect(paths.json).toBeTruthy();
    expect(paths.markdown).toBeTruthy();
  });

  it('write always produces an HTML report', async () => {
    const report = makeReport();
    const paths = await reporter.write(report);

    expect(paths.html).toBeTruthy();
    const html = writtenFiles.get(paths.html!)!;
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('test-session-001');
  });

  it('write produces timeline and annotations JSON files', async () => {
    const report = makeReport();
    const paths = await reporter.write(report);

    expect(paths.timeline).toBeTruthy();
    expect(paths.annotations).toBeTruthy();
    expect(writtenFiles.has(paths.timeline!)).toBe(true);
    expect(writtenFiles.has(paths.annotations!)).toBe(true);
  });

  it('write does not produce optional files when extras are empty', async () => {
    const report = makeReport();
    const paths = await reporter.write(report, 'both', {});

    expect(paths.eventLog).toBeUndefined();
    expect(paths.failures).toBeUndefined();
    expect(paths.diffs).toBeUndefined();
    expect(paths.bugs).toBeUndefined();
    expect(paths.trace).toBeUndefined();
  });

  it('write produces optional files when extras are provided', async () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      eventLog: [{ event: 'click', timestamp: '2025-04-10T15:01:00Z', payload: { x: 1 } }],
      failures: [{ type: 'network', message: 'timeout', url: 'https://bad.com', status: 500 }],
      diffs: [{ interactionIndex: 1, url: 'https://example.com', urlChanged: true, notes: 'redirected' }],
      bugs: [{ id: 'b1', type: 'layout', severity: 'high', description: 'Overflow on mobile' }],
      trace: [{ frameIndex: 0, timestamp: '2025-04-10T15:01:00Z', relativeTimeMs: 0, type: 'action', action: 'click', details: { selector: 'button' } }],
    };

    const paths = await reporter.write(report, 'both', extras);

    expect(paths.eventLog).toBeTruthy();
    expect(paths.failures).toBeTruthy();
    expect(paths.diffs).toBeTruthy();
    expect(paths.bugs).toBeTruthy();
    expect(paths.trace).toBeTruthy();
  });

  it('write skips optional files when extras arrays are empty', async () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      eventLog: [],
      failures: [],
      diffs: [],
      bugs: [],
    };

    const paths = await reporter.write(report, 'both', extras);

    expect(paths.eventLog).toBeUndefined();
    expect(paths.failures).toBeUndefined();
    expect(paths.diffs).toBeUndefined();
    expect(paths.bugs).toBeUndefined();
  });

  // ─── toMarkdown() ──────────────────────────────────────────────────────────

  it('toMarkdown produces a header with session id', () => {
    const report = makeReport();
    const md = reporter.toMarkdown(report);
    expect(md).toContain('# Talox Session Report · `test-session-001`');
  });

  it('toMarkdown includes the start URL and duration', () => {
    const report = makeReport();
    const md = reporter.toMarkdown(report);
    expect(md).toContain('https://example.com');
    expect(md).toContain('30m');
  });

  it('toMarkdown includes a Summary table', () => {
    const report = makeReport();
    const md = reporter.toMarkdown(report);
    expect(md).toContain('## Summary');
    expect(md).toContain('Interactions');
    expect(md).toContain('Annotations');
  });

  it('toMarkdown includes a Timeline section', () => {
    const report = makeReport();
    const md = reporter.toMarkdown(report);
    expect(md).toContain('## Timeline');
  });

  it('toMarkdown renders annotation labels by label when present', () => {
    const report = makeReport({
      summary: {
        totalInteractions: 1,
        totalAnnotations: 1,
        totalConsoleErrors: 0,
        totalNetworkFailures: 0,
        annotationsByLabel: { bug: 1, note: 2 },
      },
    });
    const md = reporter.toMarkdown(report);
    expect(md).toContain('Annotations by label');
    expect(md).toContain('bug');
    expect(md).toContain('note');
  });

  it('toMarkdown includes Errors & Failures section when present', () => {
    const report = makeReport({
      interactions: [makeInteraction({
        consoleErrors: ['TypeError: foo'],
        networkFailures: [{ url: 'https://bad.com', status: 500 }],
      })],
      summary: {
        totalInteractions: 1,
        totalAnnotations: 0,
        totalConsoleErrors: 1,
        totalNetworkFailures: 1,
        annotationsByLabel: {},
      },
    });
    const md = reporter.toMarkdown(report);
    expect(md).toContain('## Errors & Failures');
    expect(md).toContain('TypeError: foo');
    expect(md).toContain('https://bad.com');
  });

  it('toMarkdown includes Event Log extras when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      eventLog: [{ event: 'click', timestamp: '2025-04-10T15:01:00Z' }],
    };
    const md = reporter.toMarkdown(report, extras);
    expect(md).toContain('## Event Log');
    expect(md).toContain('click');
  });

  it('toMarkdown includes Bug Summaries extras when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      bugs: [{ id: 'b1', type: 'layout', severity: 'high', description: 'Overflow' }],
    };
    const md = reporter.toMarkdown(report, extras);
    expect(md).toContain('## Bug Summaries');
    expect(md).toContain('Overflow');
    expect(md).toContain('high');
  });

  it('toMarkdown includes Failure Highlights extras when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      failures: [{ type: 'network', message: 'timeout', url: 'https://x.com', status: 504 }],
    };
    const md = reporter.toMarkdown(report, extras);
    expect(md).toContain('## Failure Highlights');
    expect(md).toContain('timeout');
  });

  it('toMarkdown includes Interaction Diffs extras when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      diffs: [{ interactionIndex: 1, url: 'https://example.com', urlChanged: true }],
    };
    const md = reporter.toMarkdown(report, extras);
    expect(md).toContain('## Interaction Diffs');
  });

  it('toMarkdown includes Action Trace when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      trace: [{ frameIndex: 0, timestamp: '2025-04-10T15:01:00Z', relativeTimeMs: 0, type: 'action', action: 'click', details: { selector: 'button' } }],
    };
    const md = reporter.toMarkdown(report, extras);
    expect(md).toContain('## Action Trace');
    expect(md).toContain('first 10 shown');
  });

  it('toMarkdown includes Annotations table when annotations exist', () => {
    const report = makeReport({
      annotations: [{
        id: 'a1',
        interactionIndex: 1,
        timestamp: '2025-04-10T15:01:00.000Z',
        labels: ['bug'],
        comment: 'Button not working',
        element: {
          tag: 'button',
          selector: 'button#submit',
          boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        },
      }],
      summary: {
        totalInteractions: 1,
        totalAnnotations: 1,
        totalConsoleErrors: 0,
        totalNetworkFailures: 0,
        annotationsByLabel: { bug: 1 },
      },
    });
    const md = reporter.toMarkdown(report);
    expect(md).toContain('## Annotations');
    expect(md).toContain('Button not working');
  });

  // ─── toHTML() ──────────────────────────────────────────────────────────────

  it('toHTML produces a valid HTML document', () => {
    const report = makeReport();
    const html = reporter.toHTML(report);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<title>Talox Session test-session-001</title>');
  });

  it('toHTML includes a Summary table', () => {
    const report = makeReport();
    const html = reporter.toHTML(report);
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('Interactions');
  });

  it('toHTML includes a Timeline section', () => {
    const report = makeReport();
    const html = reporter.toHTML(report);
    expect(html).toContain('<h2>Timeline</h2>');
  });

  it('toHTML includes Event Log when extras provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      eventLog: [{ event: 'click', timestamp: '2025-04-10T15:01:00Z' }],
    };
    const html = reporter.toHTML(report, extras);
    expect(html).toContain('<h2>Event Log</h2>');
  });

  it('toHTML includes Bugs when extras provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      bugs: [{ id: 'b1', type: 'layout', severity: 'high', description: 'Overflow' }],
    };
    const html = reporter.toHTML(report, extras);
    expect(html).toContain('<h2>Bug Summaries</h2>');
    expect(html).toContain('Overflow');
  });

  it('toHTML escapes special characters in escaped sections', () => {
    const report = makeReport({
      id: '<script>alert("xss")</script>',
    });
    const html = reporter.toHTML(report);
    // The <h1> tag uses escapeHtml — verify the ID is escaped there
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('toHTML includes Action Trace when provided', () => {
    const report = makeReport();
    const extras: SessionReportExtras = {
      trace: [
        { frameIndex: 0, timestamp: '2025-04-10T15:01:00Z', relativeTimeMs: 0, type: 'action', action: 'click', details: { selector: 'button' } },
        { frameIndex: 1, timestamp: '2025-04-10T15:02:00Z', relativeTimeMs: 1000, type: 'action', action: 'type', details: { text: 'hello' } },
      ],
    };
    const html = reporter.toHTML(report, extras);
    expect(html).toContain('<h2>Action Trace</h2>');
    expect(html).toContain('Showing 2 of 2 frames');
  });
});
