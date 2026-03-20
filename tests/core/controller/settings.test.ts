import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, type TaloxSettings } from '../../../src/types/settings';

describe('TaloxSettings (v2)', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('should have valid mouseSpeed range', () => {
      expect(DEFAULT_SETTINGS.mouseSpeed).toBeGreaterThanOrEqual(0.1);
      expect(DEFAULT_SETTINGS.mouseSpeed).toBeLessThanOrEqual(3.0);
    });

    it('should have stealthLevel set to high', () => {
      expect(DEFAULT_SETTINGS.stealthLevel).toBe('high');
    });

    it('should have humanStealth at full', () => {
      expect(DEFAULT_SETTINGS.humanStealth).toBe(1.0);
    });

    it('should have adaptiveStealthEnabled true', () => {
      expect(DEFAULT_SETTINGS.adaptiveStealthEnabled).toBe(true);
    });

    it('should have perceptionDepth as full', () => {
      expect(DEFAULT_SETTINGS.perceptionDepth).toBe('full');
    });

    it('should have autoHeadedEscalation true', () => {
      expect(DEFAULT_SETTINGS.autoHeadedEscalation).toBe(true);
    });

    it('should have verbosity 0 by default', () => {
      expect(DEFAULT_SETTINGS.verbosity).toBe(0);
    });

    it('should have humanTakeoverTimeoutMs at 2 minutes', () => {
      expect(DEFAULT_SETTINGS.humanTakeoverTimeoutMs).toBe(120000);
    });
  });

  describe('TaloxSettings interface', () => {
    it('should accept all required fields', () => {
      const settings: TaloxSettings = { ...DEFAULT_SETTINGS };
      expect(settings.mouseSpeed).toBeDefined();
      expect(settings.stealthLevel).toBeDefined();
    });
  });
});
