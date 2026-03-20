import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaloxController } from '../../../src/core/controller/TaloxController';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

describe('TaloxController (v2)', () => {
  let talox: TaloxController;

  describe('constructor', () => {
    it('should use DEFAULT_SETTINGS when no config provided', () => {
      talox = new TaloxController('.');
      expect(talox.getSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('should merge user config with defaults', () => {
      talox = new TaloxController('.', { 
        settings: { mouseSpeed: 1.5 } 
      });
      expect(talox.getSettings().mouseSpeed).toBe(1.5);
      expect(talox.getSettings().stealthLevel).toBe(DEFAULT_SETTINGS.stealthLevel);
    });

    it('should handle humanTakeover boolean shorthand', () => {
      talox = new TaloxController('.', { humanTakeover: true });
      expect(talox.getSettings().humanTakeoverEnabled).toBe(true);
      expect(talox.getSettings().humanTakeoverTimeoutMs).toBe(DEFAULT_SETTINGS.humanTakeoverTimeoutMs);
    });

    it('should handle humanTakeover object config', () => {
      talox = new TaloxController('.', { 
        humanTakeover: { timeoutMs: 60000 } 
      });
      expect(talox.getSettings().humanTakeoverTimeoutMs).toBe(60000);
    });

    it('should set headed: true when observe: true', () => {
      talox = new TaloxController('.', { observe: true });
      expect(talox.getSettings().headed).toBe(true);
    });
  });

  describe('verbosity', () => {
    it('should have default verbosity of 0', () => {
      talox = new TaloxController('.');
      expect(talox.getVerbosity()).toBe(0);
    });

    it('should set and get verbosity', () => {
      talox = new TaloxController('.');
      talox.setVerbosity(2);
      expect(talox.getVerbosity()).toBe(2);
    });

    it('should emit verbosityChanged event', () => {
      talox = new TaloxController('.');
      const handler = vi.fn();
      talox.on('verbosityChanged', handler);
      talox.setVerbosity(1);
      expect(handler).toHaveBeenCalledWith({ level: 1 });
    });
  });

  describe('human takeover', () => {
    it('should start in AGENT_RUNNING state', () => {
      talox = new TaloxController('.');
      expect(talox.getTakeoverState()).toBe('AGENT_RUNNING');
    });

    it('should transition to WAITING_FOR_HUMAN on requestHumanTakeover', async () => {
      talox = new TaloxController('.');
      await talox.requestHumanTakeover('Test reason');
      expect(talox.getTakeoverState()).toBe('WAITING_FOR_HUMAN');
    });

    it('should emit humanTakeoverRequested event', async () => {
      talox = new TaloxController('.');
      const handler = vi.fn();
      talox.on('humanTakeoverRequested', handler);
      await talox.requestHumanTakeover('Test');
      expect(handler).toHaveBeenCalled();
    });

    it('should resume to AGENT_RUNNING on resumeAgent', async () => {
      talox = new TaloxController('.');
      await talox.requestHumanTakeover();
      talox.resumeAgent();
      expect(talox.getTakeoverState()).toBe('AGENT_RUNNING');
    });
  });

  describe('headed mode', () => {
    it('should have default headed: false', () => {
      talox = new TaloxController('.');
      expect(talox.isHeaded()).toBe(false);
    });
  });
});
