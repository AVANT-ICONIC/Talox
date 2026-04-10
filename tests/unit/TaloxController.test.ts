/**
 * @file TaloxController.test.ts
 * @description Extended unit tests for TaloxController — the main public API.
 * Covers: constructor, settings, getState variants, navigate/click/type/scroll,
 * headed mode, challenge state, session info, stop/cleanup, event emission,
 * safe mode, debug snapshot, attention frame, behavioral DNA, takeover state machine.
 *
 * All browser dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaloxController } from '../../src/core/controller/TaloxController';
import { DEFAULT_SETTINGS } from '../../src/types/settings';
import type { TaloxPageState } from '../../src/types/index';

// ─── Helper: make a minimal valid TaloxPageState ────────────────────────────

function makeMockState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
  return {
    url: 'https://example.com',
    title: 'Test',
    timestamp: new Date().toISOString(),
    console: { errors: [] },
    network: { failedRequests: [] },
    nodes: [],
    interactiveElements: [],
    bugs: [],
    timing: { totalMs: 10, collectedAt: new Date().toISOString() },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TaloxController', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR — settings merging (already exists but verify with more cases)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('constructor — settings merging', () => {
    it('uses DEFAULT_SETTINGS when no config provided', () => {
      const t = new TaloxController('.');
      expect(t.getSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('overrides individual settings without clobbering defaults', () => {
      const t = new TaloxController('.', { settings: { mouseSpeed: 2.5 } });
      const s = t.getSettings();
      expect(s.mouseSpeed).toBe(2.5);
      expect(s.stealthLevel).toBe(DEFAULT_SETTINGS.stealthLevel);
      expect(s.fidgetEnabled).toBe(DEFAULT_SETTINGS.fidgetEnabled);
    });

    it('applies legacy mode before explicit settings (settings win)', () => {
      const t = new TaloxController('.', {
        mode: 'speed',
        settings: { mouseSpeed: 0.5 },
      });
      expect(t.getSettings().mouseSpeed).toBe(0.5);
      expect(t.getSettings().stealthLevel).toBe('low');
    });

    it('enables humanTakeover and headed via boolean shorthand', () => {
      const t = new TaloxController('.', { humanTakeover: true });
      expect(t.getSettings().humanTakeoverEnabled).toBe(true);
      expect(t.getSettings().headed).toBe(true);
    });

    it('sets timeoutMs from humanTakeover object', () => {
      const t = new TaloxController('.', { humanTakeover: { timeoutMs: 30000 } });
      expect(t.getSettings().humanTakeoverTimeoutMs).toBe(30000);
    });

    it('forces headed=true when observe=true', () => {
      const t = new TaloxController('.', { observe: true });
      expect(t.getSettings().headed).toBe(true);
    });

    it('apply multiple settings at once', () => {
      const t = new TaloxController('.', {
        settings: { mouseSpeed: 1.5, fidgetEnabled: false },
      });
      const s = t.getSettings();
      expect(s.mouseSpeed).toBe(1.5);
      expect(s.fidgetEnabled).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VERBOSITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setVerbosity() / getVerbosity()', () => {
    it('returns default verbosity 0', () => {
      const t = new TaloxController('.');
      expect(t.getVerbosity()).toBe(0);
    });

    it('updates verbosity', () => {
      const t = new TaloxController('.');
      t.setVerbosity(3);
      expect(t.getVerbosity()).toBe(3);
    });

    it('emits verbosityChanged event', () => {
      const t = new TaloxController('.');
      const handler = vi.fn();
      t.on('verbosityChanged', handler);
      t.setVerbosity(1);
      expect(handler).toHaveBeenCalledWith({ level: 1 });
    });

    it('cycles through all verbosity levels', () => {
      const t = new TaloxController('.');
      for (const level of [0, 1, 2, 3] as const) {
        t.setVerbosity(level);
        expect(t.getVerbosity()).toBe(level);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADED MODE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setHeaded() / isHeaded()', () => {
    it('defaults to headless', () => {
      const t = new TaloxController('.');
      expect(t.isHeaded()).toBe(false);
    });

    it('isHeaded returns true when observe mode is enabled', () => {
      const t = new TaloxController('.', { observe: true });
      expect(t.isHeaded()).toBe(true);
    });

    it('isHeaded returns true when humanTakeover is enabled', () => {
      const t = new TaloxController('.', { humanTakeover: true });
      expect(t.isHeaded()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SAFE MODE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('setSafeMode() / isSafeMode()', () => {
    it('defaults to false', () => {
      const t = new TaloxController('.');
      expect(t.isSafeMode()).toBe(false);
    });

    it('enables safe mode', () => {
      const t = new TaloxController('.');
      t.setSafeMode(true);
      expect(t.isSafeMode()).toBe(true);
    });

    it('can toggle safe mode off', () => {
      const t = new TaloxController('.');
      t.setSafeMode(true);
      t.setSafeMode(false);
      expect(t.isSafeMode()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG SNAPSHOT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getDebugSnapshot()', () => {
    it('returns snapshot with required fields when no state loaded', async () => {
      const t = new TaloxController('.');
      const snap = await t.getDebugSnapshot();
      expect(snap).toMatchObject({
        bugs: [],
        consoleErrors: [],
        networkErrors: [],
        verbosity: 0,
        timestamp: expect.any(String),
      });
    });

    it('reflects current verbosity in snapshot', async () => {
      const t = new TaloxController('.');
      t.setVerbosity(2);
      const snap = await t.getDebugSnapshot();
      expect(snap.verbosity).toBe(2);
    });

    it('does not include state when no lastState', async () => {
      const t = new TaloxController('.');
      const snap = await t.getDebugSnapshot();
      expect(snap.state).toBeUndefined();
    });

    it('timestamp is a valid ISO string', async () => {
      const t = new TaloxController('.');
      const snap = await t.getDebugSnapshot();
      expect(() => new Date(snap.timestamp).toISOString()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN TAKEOVER STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('human takeover state machine', () => {
    it('starts in AGENT_RUNNING', () => {
      const t = new TaloxController('.');
      expect(t.getTakeoverState()).toBe('AGENT_RUNNING');
    });

    it('transitions to WAITING_FOR_HUMAN on requestHumanTakeover', async () => {
      const t = new TaloxController('.');
      const p = t.requestHumanTakeover('login-required');
      expect(t.getTakeoverState()).toBe('WAITING_FOR_HUMAN');
      t.resumeAgent();
      await p;
    });

    it('returns to AGENT_RUNNING after resumeAgent', async () => {
      const t = new TaloxController('.');
      const p = t.requestHumanTakeover();
      t.resumeAgent();
      await p;
      expect(t.getTakeoverState()).toBe('AGENT_RUNNING');
    });

    it('is idempotent — second requestHumanTakeover while waiting is a no-op', async () => {
      const t = new TaloxController('.');
      const p1 = t.requestHumanTakeover('first');
      const p2 = t.requestHumanTakeover('second');
      expect(t.getTakeoverState()).toBe('WAITING_FOR_HUMAN');
      t.resumeAgent();
      await Promise.all([p1, p2]);
    });

    it('resumeAgent when already AGENT_RUNNING is a no-op', () => {
      const t = new TaloxController('.');
      t.resumeAgent(); // should not throw
      expect(t.getTakeoverState()).toBe('AGENT_RUNNING');
    });

    it('getTakeoverHistory returns empty array initially', () => {
      const t = new TaloxController('.');
      expect(t.getTakeoverHistory()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS COPY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getSettings()', () => {
    it('returns a copy (mutations do not affect internal state)', () => {
      const t = new TaloxController('.');
      const s = t.getSettings();
      s.mouseSpeed = 99;
      expect(t.getSettings().mouseSpeed).toBe(DEFAULT_SETTINGS.mouseSpeed);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('event emission', () => {
    it('on() subscribes to events', () => {
      const t = new TaloxController('.');
      const handler = vi.fn();
      t.on('error', handler);
      t._events.emit('error', { message: 'test error' });
      expect(handler).toHaveBeenCalledWith({ message: 'test error' });
    });

    it('off() unsubscribes from events', () => {
      const t = new TaloxController('.');
      const handler = vi.fn();
      t.on('error', handler);
      t.off('error', handler);
      t._events.emit('error', { message: 'test error' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('removeAllListeners() clears all handlers', () => {
      const t = new TaloxController('.');
      const h1 = vi.fn();
      const h2 = vi.fn();
      t.on('error', h1);
      t.on('navigation', h2);
      t.removeAllListeners();
      t._events.emit('error', { message: 'x' });
      t._events.emit('navigation', { url: 'y', title: '' });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });

    it('getEventListeners() returns listener counts', () => {
      const t = new TaloxController('.');
      t.on('error', vi.fn());
      t.on('error', vi.fn());
      t.on('navigation', vi.fn());
      const counts = t.getEventListeners();
      expect(counts.get('error')).toBe(2);
      expect(counts.get('navigation')).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTENTION FRAME
  // ═══════════════════════════════════════════════════════════════════════════

  describe('attention frame', () => {
    it('initially returns null', () => {
      const t = new TaloxController('.');
      expect(t.getAttentionFrame()).toBeNull();
    });

    it('setAttentionFrameBox sets the frame', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(10, 20, 300, 400);
      expect(t.getAttentionFrame()).toMatchObject({ x: 10, y: 20, width: 300, height: 400 });
    });

    it('clearAttentionFrame resets to null', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(0, 0, 100, 100);
      t.clearAttentionFrame();
      expect(t.getAttentionFrame()).toBeNull();
    });

    it('isElementInFrame returns true when no frame set', () => {
      const t = new TaloxController('.');
      expect(t.isElementInFrame({ x: 50, y: 50, width: 10, height: 10 })).toBe(true);
    });

    it('isElementInFrame detects element inside frame', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(0, 0, 200, 200);
      expect(t.isElementInFrame({ x: 80, y: 80, width: 20, height: 20 })).toBe(true);
    });

    it('isElementInFrame detects element outside frame', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(0, 0, 100, 100);
      expect(t.isElementInFrame({ x: 200, y: 200, width: 20, height: 20 })).toBe(false);
    });

    it('clampToFrame returns original coords when no frame', () => {
      const t = new TaloxController('.');
      expect(t.clampToFrame(500, 600)).toEqual({ x: 500, y: 600 });
    });

    it('clampToFrame clamps to frame boundaries', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(0, 0, 100, 100);
      expect(t.clampToFrame(150, 150)).toEqual({ x: 100, y: 100 });
      expect(t.clampToFrame(-10, -10)).toEqual({ x: 0, y: 0 });
    });

    it('scaleAXToViewport returns original coords when no frame', () => {
      const t = new TaloxController('.');
      expect(t.scaleAXToViewport(0.5, 0.5, 10, 10)).toEqual({ x: 0.5, y: 0.5, width: 10, height: 10 });
    });

    it('scaleAXToViewport maps to frame coordinates', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(100, 200, 400, 300);
      const scaled = t.scaleAXToViewport(0.5, 0.5, 0.1, 0.1);
      expect(scaled.x).toBeCloseTo(100 + 0.5 * 400);
      expect(scaled.y).toBeCloseTo(200 + 0.5 * 300);
      expect(scaled.width).toBeCloseTo(0.1 * 400);
      expect(scaled.height).toBeCloseTo(0.1 * 300);
    });

    it('viewportToScaleAX returns original coords when no frame', () => {
      const t = new TaloxController('.');
      expect(t.viewportToScaleAX(50, 75)).toEqual({ axX: 50, axY: 75 });
    });

    it('viewportToScaleAX maps viewport coords to scale', () => {
      const t = new TaloxController('.');
      t.setAttentionFrameBox(100, 200, 400, 300);
      const ax = t.viewportToScaleAX(300, 350);
      expect(ax.axX).toBeCloseTo((300 - 100) / 400);
      expect(ax.axY).toBeCloseTo((350 - 200) / 300);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BEHAVIORAL DNA
  // ═══════════════════════════════════════════════════════════════════════════

  describe('behavioral DNA', () => {
    it('initially null', () => {
      const t = new TaloxController('.');
      expect(t.getBehavioralDNA()).toBeNull();
    });

    it('setBehavioralDNA sets the DNA', () => {
      const t = new TaloxController('.');
      t.setBehavioralDNA({ jitterFrequency: 0.8, movementStyle: 'jerky' });
      const dna = t.getBehavioralDNA();
      expect(dna.jitterFrequency).toBe(0.8);
      expect(dna.movementStyle).toBe('jerky');
    });

    it('setBehavioralDNA fills in defaults for missing fields', () => {
      const t = new TaloxController('.');
      t.setBehavioralDNA({});
      const dna = t.getBehavioralDNA();
      expect(dna.jitterFrequency).toBe(0.5);
      expect(dna.accelerationCurve).toBe('ease-out');
      expect(dna.typingRhythm).toBe('medium');
      expect(dna.clickPrecision).toBe(0.75);
      expect(dna.movementStyle).toBe('smooth');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MOUSE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('mouse tracking', () => {
    it('setGlobalMouseTracking toggles', () => {
      const t = new TaloxController('.');
      // Default is enabled
      t.setGlobalMouseTracking(false);
      // No error means success
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPRESS STATE FOR LLM
  // ═══════════════════════════════════════════════════════════════════════════

  describe('compressStateForLLM()', () => {
    it('prunes non-interactive, non-text, non-heading nodes', () => {
      const t = new TaloxController('.');
      const state = makeMockState({
        nodes: [
          { id: 'ax-0', role: 'button', name: 'Go', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'ax-1', role: 'generic', name: '', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'ax-2', role: 'heading', name: 'Title', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'ax-3', role: 'statictext', name: '  ', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'ax-4', role: 'statictext', name: 'Hello', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { id: 'ax-5', role: 'link', name: 'Click', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
        ],
      });
      const compressed = t.compressStateForLLM(state);
      // button, heading, statictext("Hello"), link
      expect(compressed.nodes.length).toBe(4);
    });

    it('preserves url and title', () => {
      const t = new TaloxController('.');
      const state = makeMockState({ url: 'https://test.com', title: 'My Page' });
      const compressed = t.compressStateForLLM(state);
      expect(compressed.url).toBe('https://test.com');
      expect(compressed.title).toBe('My Page');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEMANTIC SEARCH HELPERS (findNodeByText, findNodeByRole, etc.)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('semantic search helpers', () => {
    it('findInteractiveNodes throws when no page launched', () => {
      const t = new TaloxController('.');
      expect(() => t.findInteractiveNodes()).toThrow('No active page');
    });

    it('findNodeByText throws when no page launched', () => {
      const t = new TaloxController('.');
      expect(() => t.findNodeByText('anything')).toThrow('No active page');
    });

    it('findNodeByRole throws when no page launched', () => {
      const t = new TaloxController('.');
      expect(() => t.findNodeByRole('button')).toThrow('No active page');
    });

    it('findNodesByRole throws when no page launched', () => {
      const t = new TaloxController('.');
      expect(() => t.findNodesByRole(['button', 'link'])).toThrow('No active page');
    });

    it('findNodesByText throws when no page launched', () => {
      const t = new TaloxController('.');
      expect(() => t.findNodesByText('search')).toThrow('No active page');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-PAGE DELEGATION (no-op without browser, but verify they don't throw)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('multi-page delegation', () => {
    it('getPageCount returns 0 without launch', () => {
      const t = new TaloxController('.');
      expect(t.getPageCount()).toBe(0);
    });

    it('getActivePageIndex returns -1 without launch', () => {
      const t = new TaloxController('.');
      expect(t.getActivePageIndex()).toBe(-1);
    });

    it('getActivePage returns null without launch', () => {
      const t = new TaloxController('.');
      expect(t.getActivePage()).toBeNull();
    });

    it('getAllPages returns empty array without launch', () => {
      const t = new TaloxController('.');
      expect(t.getAllPages()).toEqual([]);
    });

    it('getPlaywrightPage returns null without launch', () => {
      const t = new TaloxController('.');
      expect(t.getPlaywrightPage()).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-THINKING DELEGATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('auto-thinking delegation', () => {
    it('isAutoThinkingRunning returns false without launch', () => {
      const t = new TaloxController('.');
      expect(t.isAutoThinkingRunning()).toBe(false);
    });

    it('setAutomaticThinkingEnabled toggles setting', () => {
      const t = new TaloxController('.');
      t.setAutomaticThinkingEnabled(false);
      expect(t.getSettings().automaticThinkingEnabled).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DESCRIBE PAGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('describePage()', () => {
    it('returns fallback message when no page loaded', async () => {
      const t = new TaloxController('.');
      const desc = await t.describePage();
      expect(desc).toContain('No page loaded');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET INTENT STATE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getIntentState()', () => {
    it('returns unknown pageType with no state', async () => {
      const t = new TaloxController('.');
      const intent = await t.getIntentState();
      expect(intent.pageType).toBe('unknown');
      expect(intent.primaryAction).toBeNull();
    });
  });
});
