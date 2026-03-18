/**
 * @file ModeManager.ts
 * @description Mode lifecycle management for TaloxController.
 *
 * Manages the four canonical modes, their settings presets, deprecated alias
 * resolution, and runtime override/patch operations. Single source of truth
 * for all mode-related state.
 */

import type { TaloxSettings }           from '../../types/index.js';
import type { TaloxEventMap }           from '../../types/events.js';
import { type AnyTaloxMode, type TaloxMode, resolveMode } from '../../types/modes.js';
import type { EventBus }                from './EventBus.js';

// ─── Mode Presets ─────────────────────────────────────────────────────────────

/**
 * Default settings baseline. All presets are applied on top of these defaults.
 */
const DEFAULT_SETTINGS: TaloxSettings = {
  mouseSpeed:                 1.0,
  typingDelayMin:             50,
  typingDelayMax:             150,
  stealthLevel:               'medium',
  perceptionDepth:            'full',
  fidgetEnabled:              true,
  humanStealth:               0.5,
  typoProbability:            0.08,
  adaptiveStealthEnabled:     false,
  adaptiveStealthSensitivity: 1.0,
  adaptiveStealthRadius:      150,
  precisionDecay:             0.0,
  automaticThinkingEnabled:   false,
  idleTimeout:                5000,
};

/**
 * Settings presets for the four canonical modes.
 *
 * | Mode      | Purpose                        | Mouse Speed | Human Sim |
 * |-----------|--------------------------------|-------------|-----------|
 * | `smart`   | Production agents, self-healing| 0.7×        | Full      |
 * | `speed`   | CI/bulk, raw Playwright        | 3.0×        | None      |
 * | `debug`   | Reproducible failure diagnosis | 1.0×        | Minimal   |
 * | `observe` | Human-driven sessions          | 1.0×        | None      |
 */
const MODE_PRESETS: Record<TaloxMode, Partial<TaloxSettings>> = {
  smart: {
    mouseSpeed:               0.7,
    stealthLevel:             'high',
    fidgetEnabled:            true,
    humanStealth:             1.0,
    typingDelayMin:           100,
    typingDelayMax:           300,
    typoProbability:          0.08,
    precisionDecay:           0,
    adaptiveStealthEnabled:   true,
    automaticThinkingEnabled: true,
    perceptionDepth:          'full',
  },
  speed: {
    mouseSpeed:               3.0,
    stealthLevel:             'low',
    fidgetEnabled:            false,
    humanStealth:             0,
    typoProbability:          0,
    precisionDecay:           0,
    adaptiveStealthEnabled:   false,
    automaticThinkingEnabled: false,
    perceptionDepth:          'shallow',
  },
  debug: {
    mouseSpeed:               1.0,
    stealthLevel:             'medium',
    fidgetEnabled:            false,
    humanStealth:             0.5,
    typingDelayMin:           75,
    typingDelayMax:           200,
    typoProbability:          0.02,
    precisionDecay:           0,
    adaptiveStealthEnabled:   false,
    automaticThinkingEnabled: false,
    perceptionDepth:          'full',
  },
  observe: {
    mouseSpeed:               1.0,
    stealthLevel:             'low',
    fidgetEnabled:            false,
    humanStealth:             0,
    typoProbability:          0,
    precisionDecay:           0,
    adaptiveStealthEnabled:   false,
    automaticThinkingEnabled: false,
    perceptionDepth:          'full', // capture everything the human encounters
  },
};

// ─── ModeManager ─────────────────────────────────────────────────────────────

/**
 * Single source of truth for Talox's execution mode and settings.
 *
 * Responsibilities:
 * - Resolving and applying mode presets (including deprecated aliases)
 * - Providing granular `override()` and `updateSettings()` patch operations
 * - Firing `modeChanged` events via the shared `EventBus`
 * - Exposing mode-capability queries (`isAutoThinkingSupported()`, etc.)
 */
export class ModeManager {
  private current: TaloxMode;
  private settings: TaloxSettings;
  private readonly eventBus: EventBus<TaloxEventMap>;

  constructor(eventBus: EventBus<TaloxEventMap>, initialMode: AnyTaloxMode = 'smart') {
    this.eventBus = eventBus;
    this.settings = { ...DEFAULT_SETTINGS };
    this.current  = 'smart'; // set via setMode to apply preset
    this.setMode(initialMode);
  }

  // ─── Mode ───────────────────────────────────────────────────────────────────

  /**
   * Switch to a new mode. Applies the mode preset over the current settings.
   * Deprecated mode strings are accepted and mapped to `'smart'` with a warning.
   * Fires a `modeChanged` event.
   */
  setMode(mode: AnyTaloxMode | string): void {
    const resolved = resolveMode(mode);
    this.current   = resolved;

    const preset = MODE_PRESETS[resolved];
    if (preset) {
      this.settings = { ...this.settings, ...preset };
    }

    this.eventBus.emit('modeChanged', { mode: resolved, settings: { ...this.settings } });
  }

  /**
   * Returns the current canonical mode.
   */
  getMode(): TaloxMode {
    return this.current;
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  /**
   * Get a snapshot of the current settings. The returned object is a copy —
   * mutating it has no effect on internal state.
   */
  getSettings(): TaloxSettings {
    return { ...this.settings };
  }

  /**
   * Apply a partial settings patch. Useful for granular overrides that
   * should persist across mode changes until explicitly reset.
   */
  updateSettings(patch: Partial<TaloxSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  /**
   * Override a single behavioral parameter by key.
   * Accepts the human-friendly `mouseSpeed` shorthand strings.
   *
   * @example
   * ```ts
   * modes.override('mouseSpeed', 'slow');   // → 0.5
   * modes.override('mouseSpeed', 2.5);      // → 2.5
   * modes.override('fidgetEnabled', false);
   * ```
   */
  override(param: keyof TaloxSettings | string, value: unknown): void {
    if (param === 'mouseSpeed' && typeof value === 'string') {
      const speedMap: Record<string, number> = { slow: 0.5, normal: 1.0, fast: 2.0 };
      value = speedMap[value] ?? 1.0;
    }
    this.updateSettings({ [param]: value } as Partial<TaloxSettings>);
  }

  // ─── Capability Queries ─────────────────────────────────────────────────────

  /**
   * Returns `true` if the current mode supports automatic idle thinking behavior.
   * Only `smart` mode enables auto-thinking via its preset.
   */
  isAutoThinkingSupported(): boolean {
    return this.current === 'smart';
  }

  /**
   * Returns `true` if the current mode should emit `bugDetected` events.
   * `debug` mode only — in all other modes bugs are collected silently.
   */
  shouldEmitBugDetected(): boolean {
    return this.current === 'debug';
  }

  /**
   * Returns `true` if the current mode should emit `consoleError` events.
   * `debug` and `observe` modes only.
   */
  shouldEmitConsoleErrors(): boolean {
    return this.current === 'debug' || this.current === 'observe';
  }

  /**
   * Returns `true` if the current mode should emit `adapted` events.
   * `smart` mode only.
   */
  shouldEmitAdapted(): boolean {
    return this.current === 'smart';
  }

  /**
   * Returns `true` if the current mode is the human-driven observe mode.
   */
  isObserveMode(): boolean {
    return this.current === 'observe';
  }

  /**
   * Returns `true` if the current mode is speed mode (raw Playwright, no simulation).
   */
  isSpeedMode(): boolean {
    return this.current === 'speed';
  }

  /**
   * Returns `true` if the current mode uses full human-like simulation
   * (HumanMouse, adaptive density, typo simulation, etc.).
   */
  isFullHumanMode(): boolean {
    return this.current === 'smart' || this.current === 'debug';
  }
}
