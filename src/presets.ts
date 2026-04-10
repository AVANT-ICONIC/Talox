import type { TaloxSettings } from './types/settings.js';
import { DEFAULT_SETTINGS } from './types/settings.js';

const buildPreset = (overrides: Partial<TaloxSettings>): TaloxSettings => {
  return Object.freeze({ ...DEFAULT_SETTINGS, ...overrides });
};

export const PRESETS = {
  ops: buildPreset({
    headed: false,
    verbosity: 0,
    humanTakeoverEnabled: false,
    stealthLevel: 'high',
    autoHeadedEscalation: true,
  }),
  qa: buildPreset({
    headed: true,
    verbosity: 2,
    humanTakeoverEnabled: true,
    humanTakeoverTimeoutMs: 0,
    adaptiveStealthEnabled: true,
    autoHeadedEscalation: false,
  }),
  observe: buildPreset({
    headed: true,
    verbosity: 2,
    humanTakeoverEnabled: true,
    autoHeadedEscalation: false,
    stealthLevel: 'medium',
    fidgetEnabled: false,
  }),
  research: buildPreset({
    headed: false,
    verbosity: 1,
    humanTakeoverEnabled: false,
    autoHeadedEscalation: true,
    stealthLevel: 'high',
    mouseSpeed: 0.7,
    adaptiveStealthSensitivity: 0.7,
  }),
  'login-heavy': buildPreset({
    headed: true,
    verbosity: 1,
    humanTakeoverEnabled: true,
    humanTakeoverTimeoutMs: 0,
    autoHeadedEscalation: true,
    stealthLevel: 'medium',
    mouseSpeed: 0.5,
  }),
};

export type PresetName = keyof typeof PRESETS;
