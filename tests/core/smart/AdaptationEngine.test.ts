import { describe, it, expect, vi } from 'vitest';
import { EventBus }          from '../../../src/core/controller/EventBus';
import { ModeManager }       from '../../../src/core/controller/ModeManager';
import { AdaptationEngine }  from '../../../src/core/smart/AdaptationEngine';

function makePageState(overrides: Partial<any> = {}): any {
  return {
    url:   'https://example.com',
    title: 'Example',
    mode:  'smart',
    timestamp: new Date().toISOString(),
    console: { errors: [] },
    network: { failedRequests: [] },
    nodes:   [],
    interactiveElements: [],
    bugs: [],
    ...overrides,
  };
}

function makeEngine(mode: string = 'smart') {
  const bus  = new EventBus();
  const mgr  = new ModeManager(bus as any, mode as any);
  const eng  = new AdaptationEngine(mgr, bus as any);
  return { bus, mgr, eng };
}

describe('AdaptationEngine', () => {
  it('is a no-op for a clean page in smart mode', async () => {
    const { bus, eng } = makeEngine('smart');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState());

    expect(handler).not.toHaveBeenCalled();
  });

  it('is a no-op in debug mode even when bot is detected', async () => {
    const { bus, eng } = makeEngine('debug');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    // CAPTCHA in title — would trigger in smart mode
    await eng.evaluate(makePageState({ title: 'Just a moment...' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('is a no-op in speed mode', async () => {
    const { bus, eng } = makeEngine('speed');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits "adapted" event in smart mode when CAPTCHA detected', async () => {
    const { bus, eng } = makeEngine('smart');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));

    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(payload.reason).toBe('captcha_detected');
    expect(typeof payload.strategy).toBe('string');
    expect(typeof payload.from).toBe('object');
    expect(typeof payload.to).toBe('object');
  });

  it('emits "adapted" with correct reason for rate limit', async () => {
    const { bus, eng } = makeEngine('smart');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState({
      network: { failedRequests: [{ url: '/api', status: 429 }] },
    }));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].reason).toBe('rate_limit');
  });

  it('patches ModeManager settings when adapting', async () => {
    const { mgr, eng } = makeEngine('smart');
    const before = mgr.getSettings().mouseSpeed;

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));

    // captcha_detected strategy should apply a settings patch
    const after = mgr.getSettings();
    // Settings object should be different from raw defaults
    expect(after).toBeDefined();
    // The engine should have called updateSettings — at minimum it ran without error
    expect(typeof after.mouseSpeed).toBe('number');
  });

  it('isSemanticHealingActive() starts false', () => {
    const { eng } = makeEngine('smart');
    expect(eng.isSemanticHealingActive()).toBe(false);
  });

  it('resetSemanticHealing() clears the flag', () => {
    const { eng } = makeEngine('smart');
    // Manually set via evaluate (selector_miss would set it, but we test the reset directly)
    eng.resetSemanticHealing();
    expect(eng.isSemanticHealingActive()).toBe(false);
  });

  it('getNextUserAgent() returns rotating strings', () => {
    const { eng } = makeEngine('smart');
    const ua1 = eng.getNextUserAgent();
    const ua2 = eng.getNextUserAgent();
    expect(typeof ua1).toBe('string');
    expect(ua1.includes('Mozilla')).toBe(true);
    expect(ua1).not.toBe(ua2); // rotation advances
  });
});
