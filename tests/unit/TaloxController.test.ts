import { describe, it, expect, vi } from 'vitest';
import { TaloxController } from '../../src/core/controller/TaloxController';
import { DEFAULT_SETTINGS } from '../../src/types/settings';

describe('TaloxController (contract surface)', () => {
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
        settings: { mouseSpeed: 0.5 }, // overrides speed mode's 2.0
      });
      expect(t.getSettings().mouseSpeed).toBe(0.5);
      // Speed mode still applied for other fields
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
  });

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
  });

  describe('setHeaded() / isHeaded()', () => {
    it('defaults to headless', () => {
      const t = new TaloxController('.');
      expect(t.isHeaded()).toBe(false);
    });
  });

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
  });

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
      const p2 = t.requestHumanTakeover('second'); // should be a no-op
      expect(t.getTakeoverState()).toBe('WAITING_FOR_HUMAN');
      t.resumeAgent();
      await Promise.all([p1, p2]);
    });
  });

  describe('getSettings()', () => {
    it('returns a copy (mutations do not affect internal state)', () => {
      const t = new TaloxController('.');
      const s = t.getSettings();
      s.mouseSpeed = 99;
      expect(t.getSettings().mouseSpeed).toBe(DEFAULT_SETTINGS.mouseSpeed);
    });
  });
});
