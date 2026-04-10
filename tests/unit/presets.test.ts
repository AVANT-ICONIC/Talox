import { describe, it, expect } from 'vitest';
import { PRESETS } from '../../src/presets.js';
import type { PresetName } from '../../src/presets.js';
import { DEFAULT_SETTINGS } from '../../src/types/settings.js';
import type { TaloxSettings } from '../../src/types/settings.js';

const PRESET_NAMES: PresetName[] = ['ops', 'qa', 'observe', 'research', 'login-heavy'];

describe('presets', () => {
  // ─── Preset existence ─────────────────────────────────────────────────────

  it('exports all expected presets', () => {
    for (const name of PRESET_NAMES) {
      expect(PRESETS).toHaveProperty(name);
    }
  });

  it('has exactly the expected preset keys', () => {
    const keys = Object.keys(PRESETS).sort();
    const expected = [...PRESET_NAMES].sort();
    expect(keys).toEqual(expected);
  });

  // ─── Preset structure ─────────────────────────────────────────────────────

  it('each preset has all required TaloxSettings fields', () => {
    const requiredKeys: (keyof TaloxSettings)[] = [
      'mouseSpeed',
      'typingDelayMin',
      'typingDelayMax',
      'typoProbability',
      'fidgetEnabled',
      'humanStealth',
      'stealthLevel',
      'adaptiveStealthEnabled',
      'automaticThinkingEnabled',
      'perceptionDepth',
      'headed',
      'autoHeadedEscalation',
      'verbosity',
      'humanTakeoverEnabled',
      'humanTakeoverTimeoutMs',
      'idleTimeout',
      'precisionDecay',
      'adaptiveStealthSensitivity',
      'adaptiveStealthRadius',
      'safeMode',
    ];

    for (const name of PRESET_NAMES) {
      const preset = PRESETS[name];
      for (const key of requiredKeys) {
        expect(preset).toHaveProperty(key);
      }
    }
  });

  // ─── Preset values are valid ──────────────────────────────────────────────

  it('mouseSpeed is within valid range (0.1 - 3.0)', () => {
    for (const name of PRESET_NAMES) {
      const speed = PRESETS[name].mouseSpeed;
      expect(speed).toBeGreaterThanOrEqual(0.1);
      expect(speed).toBeLessThanOrEqual(3.0);
    }
  });

  it('stealthLevel is one of the valid values', () => {
    const validLevels = ['low', 'medium', 'high'];
    for (const name of PRESET_NAMES) {
      expect(validLevels).toContain(PRESETS[name].stealthLevel);
    }
  });

  it('verbosity is a valid level (0-3)', () => {
    for (const name of PRESET_NAMES) {
      const v = PRESETS[name].verbosity;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('presets are frozen (immutable)', () => {
    for (const name of PRESET_NAMES) {
      const preset = PRESETS[name];
      expect(Object.isFrozen(preset)).toBe(true);
    }
  });

  it('non-ops presets override at least one field from DEFAULT_SETTINGS', () => {
    const defaults = DEFAULT_SETTINGS;
    for (const name of PRESET_NAMES) {
      if (name === 'ops') continue; // ops is intentionally identical to defaults (explicit declaration)
      const preset = PRESETS[name];
      const allKeys = Object.keys(defaults) as (keyof TaloxSettings)[];
      const hasDiff = allKeys.some(
        (key) => JSON.stringify(preset[key]) !== JSON.stringify(defaults[key]),
      );
      expect(hasDiff).toBe(true);
    }
  });

  it('qa preset has headed=true and humanTakeoverEnabled=true', () => {
    expect(PRESETS.qa.headed).toBe(true);
    expect(PRESETS.qa.humanTakeoverEnabled).toBe(true);
    expect(PRESETS.qa.humanTakeoverTimeoutMs).toBe(0);
  });

  it('research preset has high stealth and slower mouse speed', () => {
    expect(PRESETS.research.stealthLevel).toBe('high');
    expect(PRESETS.research.mouseSpeed).toBe(0.7);
    expect(PRESETS.research.adaptiveStealthSensitivity).toBe(0.7);
  });

  it('login-heavy preset has headed mode and very slow mouse', () => {
    expect(PRESETS['login-heavy'].headed).toBe(true);
    expect(PRESETS['login-heavy'].mouseSpeed).toBe(0.5);
    expect(PRESETS['login-heavy'].humanTakeoverEnabled).toBe(true);
  });

  it('typingDelayMin <= typingDelayMax for all presets', () => {
    for (const name of PRESET_NAMES) {
      const preset = PRESETS[name];
      expect(preset.typingDelayMin).toBeLessThanOrEqual(preset.typingDelayMax);
    }
  });
});
