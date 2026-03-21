import { describe, it, expect } from 'vitest';
import { 
  DEFAULT_SETTINGS, 
  type TaloxSettings,
  resolveLegacyMode,
  isLegacyMode,
  LEGACY_MODE_VALUES,
  type LegacyTaloxMode,
} from '../../../src/types/settings';

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

describe('Legacy Mode Compatibility Layer (v1 → v2)', () => {
  describe('LEGACY_MODE_VALUES', () => {
    it('should contain all valid legacy mode values', () => {
      expect(LEGACY_MODE_VALUES).toHaveLength(9);
      expect(LEGACY_MODE_VALUES).toContain('smart');
      expect(LEGACY_MODE_VALUES).toContain('debug');
      expect(LEGACY_MODE_VALUES).toContain('speed');
      expect(LEGACY_MODE_VALUES).toContain('observe');
      expect(LEGACY_MODE_VALUES).toContain('browse');
      expect(LEGACY_MODE_VALUES).toContain('adaptive');
      expect(LEGACY_MODE_VALUES).toContain('stealth');
      expect(LEGACY_MODE_VALUES).toContain('balanced');
      expect(LEGACY_MODE_VALUES).toContain('qa');
    });
  });

  describe('isLegacyMode', () => {
    it('should return true for valid legacy mode strings', () => {
      expect(isLegacyMode('smart')).toBe(true);
      expect(isLegacyMode('debug')).toBe(true);
      expect(isLegacyMode('speed')).toBe(true);
      expect(isLegacyMode('observe')).toBe(true);
      expect(isLegacyMode('browse')).toBe(true);
      expect(isLegacyMode('adaptive')).toBe(true);
    });

    it('should return false for invalid strings', () => {
      expect(isLegacyMode('invalid')).toBe(false);
      expect(isLegacyMode('')).toBe(false);
    });

    it('should return true for deprecated alias strings', () => {
      expect(isLegacyMode('stealth')).toBe(true);
      expect(isLegacyMode('balanced')).toBe(true);
      expect(isLegacyMode('qa')).toBe(true);
    });

    it('should return false for non-string values', () => {
      expect(isLegacyMode(null)).toBe(false);
      expect(isLegacyMode(undefined)).toBe(false);
      expect(isLegacyMode(123)).toBe(false);
      expect(isLegacyMode({})).toBe(false);
      expect(isLegacyMode([])).toBe(false);
    });

    it('should act as a type guard', () => {
      const value: unknown = 'smart';
      if (isLegacyMode(value)) {
        // TypeScript should narrow this to LegacyTaloxMode
        const mode: LegacyTaloxMode = value;
        expect(mode).toBe('smart');
      }
    });
  });

  describe('resolveLegacyMode', () => {
    describe('smart mode', () => {
      it('should map smart to high stealth settings', () => {
        const settings = resolveLegacyMode('smart');
        expect(settings.mouseSpeed).toBe(0.7);
        expect(settings.stealthLevel).toBe('high');
        expect(settings.adaptiveStealthEnabled).toBe(true);
        expect(settings.humanStealth).toBe(1.0);
        expect(settings.fidgetEnabled).toBe(true);
        expect(settings.verbosity).toBe(0);
      });

      it('should map adaptive identically to smart', () => {
        const smartSettings = resolveLegacyMode('smart');
        const adaptiveSettings = resolveLegacyMode('adaptive');
        expect(adaptiveSettings).toEqual(smartSettings);
      });
    });

    describe('deprecated aliases', () => {
      it('should map stealth, balanced, and qa identically to smart', () => {
        const smartSettings = resolveLegacyMode('smart');
        const stealthSettings = resolveLegacyMode('stealth');
        const balancedSettings = resolveLegacyMode('balanced');
        const qaSettings = resolveLegacyMode('qa');
        
        expect(stealthSettings).toEqual(smartSettings);
        expect(balancedSettings).toEqual(smartSettings);
        expect(qaSettings).toEqual(smartSettings);
      });

      it('should expose tradeoff warning: aliases use full stealth randomness', () => {
        const qaSettings = resolveLegacyMode('qa');
        // These settings add bot-detection warmup delays
        expect(qaSettings.stealthLevel).toBe('high');
        expect(qaSettings.adaptiveStealthEnabled).toBe(true);
        expect(qaSettings.humanStealth).toBe(1.0);
      });
    });

    describe('debug mode', () => {
      it('should map debug to high visibility settings', () => {
        const settings = resolveLegacyMode('debug');
        expect(settings.verbosity).toBe(3);
        expect(settings.headed).toBe(true);
        expect(settings.humanTakeoverEnabled).toBe(true);
        expect(settings.humanTakeoverTimeoutMs).toBe(0);
        expect(settings.stealthLevel).toBe('low');
        expect(settings.mouseSpeed).toBe(1.0);
      });
    });

    describe('speed mode', () => {
      it('should map speed to fast execution settings', () => {
        const settings = resolveLegacyMode('speed');
        expect(settings.mouseSpeed).toBe(2.0);
        expect(settings.typingDelayMin).toBe(20);
        expect(settings.typingDelayMax).toBe(50);
        expect(settings.typoProbability).toBe(0);
        expect(settings.fidgetEnabled).toBe(false);
        expect(settings.humanStealth).toBe(0.0);
        expect(settings.stealthLevel).toBe('low');
        expect(settings.adaptiveStealthEnabled).toBe(false);
      });
    });

    describe('browse mode', () => {
      it('should map browse to interactive browsing settings', () => {
        const settings = resolveLegacyMode('browse');
        expect(settings.headed).toBe(true);
        expect(settings.humanTakeoverEnabled).toBe(true);
        expect(settings.humanTakeoverTimeoutMs).toBe(0);
        expect(settings.mouseSpeed).toBe(0.8);
        expect(settings.verbosity).toBe(1);
      });
    });

    describe('observe mode', () => {
      it('should map observe to observation session settings', () => {
        const settings = resolveLegacyMode('observe');
        expect(settings.headed).toBe(true);
        expect(settings.verbosity).toBe(2);
        expect(settings.stealthLevel).toBe('medium');
        expect(settings.mouseSpeed).toBe(0.5);
      });
    });

    describe('tradeoff transparency', () => {
      it('should expose speed vs detectability tradeoff for speed mode', () => {
        const settings = resolveLegacyMode('speed');
        // Fast but more detectable
        expect(settings.mouseSpeed).toBeGreaterThan(1.0);
        expect(settings.stealthLevel).toBe('low');
        expect(settings.humanStealth).toBe(0);
      });

      it('should expose visibility vs stealth tradeoff for debug mode', () => {
        const settings = resolveLegacyMode('debug');
        // High visibility for debugging
        expect(settings.verbosity).toBe(3);
        expect(settings.stealthLevel).toBe('low');
        expect(settings.headed).toBe(true);
      });
    });
  });
});
