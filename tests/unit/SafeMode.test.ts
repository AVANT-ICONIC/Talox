/**
 * Tests for deterministic safe mode wired through TaloxSettings and
 * the ActionExecutor safeMode flag.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/types/settings.js';

describe('DEFAULT_SETTINGS.safeMode', () => {
  it('is false by default', () => {
    expect(DEFAULT_SETTINGS.safeMode).toBe(false);
  });

  it('is present as a boolean field', () => {
    expect(typeof DEFAULT_SETTINGS.safeMode).toBe('boolean');
  });
});

describe('safeMode in TaloxSettings', () => {
  it('can be overridden to true', () => {
    const settings = { ...DEFAULT_SETTINGS, safeMode: true };
    expect(settings.safeMode).toBe(true);
  });

  it('toggling does not affect other settings', () => {
    const settings = { ...DEFAULT_SETTINGS, safeMode: true };
    expect(settings.mouseSpeed).toBe(DEFAULT_SETTINGS.mouseSpeed);
    expect(settings.humanStealth).toBe(DEFAULT_SETTINGS.humanStealth);
    expect(settings.fidgetEnabled).toBe(DEFAULT_SETTINGS.fidgetEnabled);
  });
});

describe('AdaptationEngine.evaluate() return value', () => {
  it('returns boolean — this is required for recordStrategySuccess wiring', async () => {
    const { AdaptationEngine } = await import('../../src/core/smart/AdaptationEngine.js');
    const { EventBus } = await import('../../src/core/controller/EventBus.js');

    const engine = new AdaptationEngine(DEFAULT_SETTINGS, new EventBus() as any);

    // A clean state should return false (no adaptation)
    const cleanState = {
      url: 'https://example.com',
      title: 'Home',
      timestamp: new Date().toISOString(),
      console: { errors: [] },
      network: { failedRequests: [] },
      nodes: [],
      interactiveElements: [],
      bugs: [],
    };

    const result = await engine.evaluate(cleanState as any);
    expect(typeof result).toBe('boolean');
    expect(result).toBe(false);
  });
});
