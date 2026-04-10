/**
 * Unit tests for ArtifactBuilder — session action trace recording.
 */
import { describe, it, expect, vi } from 'vitest';
import { ArtifactBuilder } from '../../src/core/ArtifactBuilder.js';
import type { ActionFrame, VisualContext, ExportOptions } from '../../src/core/ArtifactBuilder.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seed the builder with a few actions. */
function seedActions(builder: ArtifactBuilder, count: number = 3): void {
  for (let i = 0; i < count; i++) {
    builder.addAction('CLICK', { selector: `#btn-${i}` }, 50 + i * 10);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArtifactBuilder', () => {
  // ── Construction & addAction ─────────────────────────────────────────────

  it('starts with an empty trace', () => {
    const builder = new ArtifactBuilder();
    const trace = builder.getTrace();
    expect(trace.actions).toHaveLength(0);
  });

  it('addAction records an action', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { selector: '#submit' });
    const trace = builder.getTrace();
    expect(trace.actions).toHaveLength(1);
    expect(trace.actions[0]!.type).toBe('CLICK');
    expect(trace.actions[0]!.payload).toEqual({ selector: '#submit' });
  });

  it('addAction includes ISO timestamp', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('NAVIGATE', { url: 'https://example.com' });
    const action = builder.getTrace().actions[0]!;
    expect(action.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('addAction stores optional durationMs', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { selector: '#btn' }, 123);
    const action = builder.getTrace().actions[0]!;
    expect(action.durationMs).toBe(123);
  });

  it('addAction stores optional visualContext', () => {
    const builder = new ArtifactBuilder();
    const vc: VisualContext = { mouseX: 100, mouseY: 200 };
    builder.addAction('CLICK', { selector: '#btn' }, undefined, vc);
    const action = builder.getTrace().actions[0]!;
    expect(action.visualContext).toEqual({ mouseX: 100, mouseY: 200 });
  });

  it('records multiple actions in order', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { idx: 0 });
    builder.addAction('INPUT', { idx: 1 });
    builder.addAction('NAVIGATE', { idx: 2 });
    const actions = builder.getTrace().actions;
    expect(actions).toHaveLength(3);
    expect(actions[0]!.type).toBe('CLICK');
    expect(actions[1]!.type).toBe('INPUT');
    expect(actions[2]!.type).toBe('NAVIGATE');
  });

  // ── getTrace ─────────────────────────────────────────────────────────────

  it('getTrace returns a copy (mutations do not affect builder)', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { a: 1 });
    const trace = builder.getTrace();
    trace.actions.push({ type: 'FAKE', payload: {}, timestamp: '' } as any);
    expect(builder.getTrace().actions).toHaveLength(1);
  });

  it('getTrace id starts with "trace-"', () => {
    const builder = new ArtifactBuilder();
    const trace = builder.getTrace();
    expect(trace.id).toMatch(/^trace-\d+$/);
  });

  // ── addMousePosition / addScrollPosition ──────────────────────────────────

  it('addMousePosition enriches the last action visual context', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    builder.addMousePosition(50, 75);
    const action = builder.getTrace().actions[0]!;
    expect(action.visualContext?.mouseX).toBe(50);
    expect(action.visualContext?.mouseY).toBe(75);
  });

  it('addMousePosition includes viewport dimensions', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    builder.addMousePosition(10, 20, 1920, 1080);
    const vc = builder.getTrace().actions[0]!.visualContext!;
    expect(vc.viewportWidth).toBe(1920);
    expect(vc.viewportHeight).toBe(1080);
  });

  it('addMousePosition does nothing when no actions exist', () => {
    const builder = new ArtifactBuilder();
    // Should not throw
    builder.addMousePosition(1, 2);
    expect(builder.getTrace().actions).toHaveLength(0);
  });

  it('addScrollPosition enriches the last action visual context', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('SCROLL', {});
    builder.addScrollPosition(350);
    const action = builder.getTrace().actions[0]!;
    expect(action.visualContext?.scrollPosition).toBe(350);
  });

  it('addMousePosition merges with existing visualContext', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {}, undefined, { scrollPosition: 100 });
    builder.addMousePosition(42, 84);
    const vc = builder.getTrace().actions[0]!.visualContext!;
    expect(vc.scrollPosition).toBe(100);
    expect(vc.mouseX).toBe(42);
    expect(vc.mouseY).toBe(84);
  });

  // ── toActionFrames ───────────────────────────────────────────────────────

  it('toActionFrames returns frames with correct indices', () => {
    const builder = new ArtifactBuilder();
    seedActions(builder, 3);
    const frames = builder.toActionFrames();
    expect(frames).toHaveLength(3);
    expect(frames[0]!.frameIndex).toBe(0);
    expect(frames[1]!.frameIndex).toBe(1);
    expect(frames[2]!.frameIndex).toBe(2);
  });

  it('toActionFrames includes relativeTimeMs', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    const frames = builder.toActionFrames();
    expect(frames[0]!.relativeTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('toActionFrames includes durationMs when present', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {}, 75);
    const frames = builder.toActionFrames();
    expect(frames[0]!.durationMs).toBe(75);
  });

  // ── formatActionType (via toActionFrames) ─────────────────────────────────

  it('formats known action types', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    builder.addAction('INPUT', {});
    builder.addAction('NAVIGATE', {});
    const frames = builder.toActionFrames();
    expect(frames[0]!.action).toBe('Click Action');
    expect(frames[1]!.action).toBe('Input Action');
    expect(frames[2]!.action).toBe('Navigation Action');
  });

  it('passes through unknown action types unchanged', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CUSTOM_THING', {});
    const frames = builder.toActionFrames();
    expect(frames[0]!.action).toBe('CUSTOM_THING');
  });

  // ── sanitizePayload (via toActionFrames) ─────────────────────────────────

  it('redacts sensitive fields in payloads', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('INPUT', {
      username: 'alice',
      password: 'secret123',
      token: 'abc',
    });
    const frame = builder.toActionFrames()[0]!;
    expect(frame.details.username).toBe('alice');
    expect(frame.details.password).toBe('[REDACTED]');
    expect(frame.details.token).toBe('[REDACTED]');
  });

  it('handles null/undefined payload gracefully', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', null as any);
    const frame = builder.toActionFrames()[0]!;
    expect(frame.details).toEqual({});
  });

  // ── exportAsJSON ─────────────────────────────────────────────────────────

  it('exportAsJSON returns valid JSON string', () => {
    const builder = new ArtifactBuilder();
    seedActions(builder);
    const json = builder.exportAsJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('sessionId');
    expect(parsed).toHaveProperty('frames');
    expect(parsed.frames).toHaveLength(3);
  });

  it('exportAsJSON with prettyPrint=false is single-line', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    const compact = builder.exportAsJSON({ prettyPrint: false });
    expect(compact).not.toMatch(/\n/);
  });

  it('exportAsJSON without payloads omits details', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { secret: 'val' });
    const json = builder.exportAsJSON({ includePayloads: false });
    const parsed = JSON.parse(json);
    expect(parsed.frames[0]).not.toHaveProperty('details');
  });

  it('exportAsJSON without visualContext omits it', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {}, undefined, { mouseX: 1, mouseY: 2 });
    const json = builder.exportAsJSON({ includeVisualContext: false });
    const parsed = JSON.parse(json);
    expect(parsed.frames[0]).not.toHaveProperty('visualContext');
  });

  // ── exportAsText ─────────────────────────────────────────────────────────

  it('exportAsText returns a readable text log', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { selector: '#btn' });
    const text = builder.exportAsText();
    expect(text).toContain('GHOST REPLAY SESSION LOG');
    expect(text).toContain('Frame 0');
    expect(text).toContain('Click Action');
  });

  it('exportAsText includes visual context when present', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {}, undefined, { mouseX: 100, mouseY: 200 });
    const text = builder.exportAsText({ includeVisualContext: true });
    expect(text).toContain('Mouse: (100, 200)');
  });

  it('exportAsText excludes details when includePayloads is false', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', { secret: 'val' });
    const text = builder.exportAsText({ includePayloads: false });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Details:');
  });

  // ── exportAsActionFrames ─────────────────────────────────────────────────

  it('exportAsActionFrames returns JSON array of frames', () => {
    const builder = new ArtifactBuilder();
    seedActions(builder, 2);
    const json = builder.exportAsActionFrames();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  // ── getSessionSummary ────────────────────────────────────────────────────

  it('getSessionSummary returns action type counts', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    builder.addAction('CLICK', {});
    builder.addAction('INPUT', {});
    const summary = builder.getSessionSummary();
    expect(summary.totalActions).toBe(3);
    expect(summary.actionTypes).toEqual({ CLICK: 2, INPUT: 1 });
  });

  it('getSessionSummary detects visual context presence', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {}, undefined, { mouseX: 1, mouseY: 2 });
    const summary = builder.getSessionSummary();
    expect(summary.hasVisualContext).toBe(true);
  });

  it('getSessionSummary reports hasVisualContext false when none', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('CLICK', {});
    const summary = builder.getSessionSummary();
    expect(summary.hasVisualContext).toBe(false);
  });

  it('getSessionSummary includes sessionId and timing', () => {
    const builder = new ArtifactBuilder();
    const summary = builder.getSessionSummary();
    expect(summary.sessionId).toMatch(/^session-\d+$/);
    expect(typeof summary.totalDurationMs).toBe('number');
    expect(summary.startTime).toMatch(/^\d{4}-/);
  });

  // ── clear ────────────────────────────────────────────────────────────────

  it('clear resets the trace', () => {
    const builder = new ArtifactBuilder();
    seedActions(builder, 5);
    expect(builder.getTrace().actions).toHaveLength(5);
    builder.clear();
    expect(builder.getTrace().actions).toHaveLength(0);
  });

  it('clear resets startTime — sessionId changes after clear', async () => {
    // Use real timers briefly so Date.now() advances between calls
    vi.useRealTimers();
    const builder = new ArtifactBuilder();
    const id1 = builder.getSessionSummary().sessionId;
    // Ensure time passes
    await new Promise(r => setTimeout(r, 2));
    builder.clear();
    const id2 = builder.getSessionSummary().sessionId;
    expect(id2).not.toBe(id1);
  });

  it('builder is usable after clear', () => {
    const builder = new ArtifactBuilder();
    builder.addAction('OLD', {});
    builder.clear();
    builder.addAction('NEW', { fresh: true });
    const actions = builder.getTrace().actions;
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe('NEW');
  });
});
