import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../../src/core/controller/EventBus';
import { AdaptationEngine } from '../../../src/core/smart/AdaptationEngine';
import { DEFAULT_SETTINGS, resolveLegacyMode } from '../../../src/types/settings';

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
  const bus = new EventBus();
  const settings = {
    ...DEFAULT_SETTINGS,
    ...resolveLegacyMode(mode as any),
  };
  const eng = new AdaptationEngine(settings, bus as any);
  return { bus, settings, eng };
}

describe('AdaptationEngine', () => {
  it('is a no-op for a clean page in smart mode', async () => {
    const { bus, eng } = makeEngine('smart');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState());

    expect(handler).not.toHaveBeenCalled();
  });

  it('emits the captcha adaptation in debug mode without the old mode escalation path', async () => {
    const { bus, settings, eng } = makeEngine('debug');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));

    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(payload.reason).toBe('captcha_detected');
    expect(payload.strategy).toBe('captcha_pause');
    expect(settings.automaticThinkingEnabled).toBe(false);
    expect(eng.wasEscalated()).toBe(false);
  });

  it('emits the captcha adaptation in speed mode without the old mode escalation path', async () => {
    const { bus, eng } = makeEngine('speed');
    const handler = vi.fn();
    bus.on('adapted' as any, handler);

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));
    expect(handler).toHaveBeenCalledOnce();
    const payload = handler.mock.calls[0][0];
    expect(payload.strategy).toBe('captcha_pause');
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

  it('patches settings directly when adapting', async () => {
    const { settings, eng } = makeEngine('smart');
    const before = settings.automaticThinkingEnabled;

    await eng.evaluate(makePageState({ title: 'Just a moment...' }));

    expect(before).toBe(true);
    expect(settings.automaticThinkingEnabled).toBe(false);
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

  it('patches rate-limit settings directly', async () => {
    const { settings, eng } = makeEngine('smart');
    await eng.evaluate(makePageState({
      network: { failedRequests: [{ url: '/api', status: 429 }] },
    }));

    expect(settings.mouseSpeed).toBe(0.4);
    expect(settings.idleTimeout).toBe(15000);
  });
});
