import { describe, it, expect, vi } from 'vitest';
import { EventBus }    from '../../../src/core/controller/EventBus';
import { ModeManager } from '../../../src/core/controller/ModeManager';

function makeManager(initialMode = 'smart') {
  const bus = new EventBus();
  const mgr = new ModeManager(bus as any, initialMode as any);
  return { bus, mgr };
}

describe('ModeManager', () => {
  it('defaults to smart mode', () => {
    const { mgr } = makeManager();
    expect(mgr.getMode()).toBe('smart');
  });

  it('resolves deprecated alias "adaptive" → "smart"', () => {
    const { mgr } = makeManager('adaptive');
    expect(mgr.getMode()).toBe('smart');
  });

  it('resolves deprecated alias "stealth" → "smart"', () => {
    const { mgr } = makeManager('stealth');
    expect(mgr.getMode()).toBe('smart');
  });

  it('resolves deprecated alias "balanced" → "smart"', () => {
    const { mgr } = makeManager('balanced');
    expect(mgr.getMode()).toBe('smart');
  });

  it('applies smart preset: high stealth, fidget enabled', () => {
    const { mgr } = makeManager('smart');
    const s = mgr.getSettings();
    expect(s.stealthLevel).toBe('high');
    expect(s.fidgetEnabled).toBe(true);
    expect(s.humanStealth).toBe(1.0);
  });

  it('applies speed preset: fidget disabled, low stealth', () => {
    const { mgr } = makeManager('speed');
    const s = mgr.getSettings();
    expect(s.fidgetEnabled).toBe(false);
    expect(s.stealthLevel).toBe('low');
    expect(s.humanStealth).toBe(0);
  });

  it('setMode() switches at runtime and fires modeChanged event', () => {
    const { bus, mgr } = makeManager('smart');
    const handler = vi.fn();
    bus.on('modeChanged' as any, handler);

    mgr.setMode('debug');

    expect(mgr.getMode()).toBe('debug');
    expect(handler).toHaveBeenCalled();
  });

  it('override() applies a single-param patch', () => {
    const { mgr } = makeManager('smart');
    mgr.override('fidgetEnabled', false);
    expect(mgr.getSettings().fidgetEnabled).toBe(false);
  });

  it('override() resolves "slow" speed string', () => {
    const { mgr } = makeManager('smart');
    mgr.override('mouseSpeed', 'slow');
    expect(mgr.getSettings().mouseSpeed).toBe(0.5);
  });

  it('updateSettings() merges partial patch', () => {
    const { mgr } = makeManager('smart');
    mgr.updateSettings({ typoProbability: 0.99 });
    expect(mgr.getSettings().typoProbability).toBe(0.99);
  });

  describe('capability queries', () => {
    it('shouldEmitBugDetected() → true only in debug mode', () => {
      const { mgr } = makeManager('debug');
      expect(mgr.shouldEmitBugDetected()).toBe(true);
      mgr.setMode('smart');
      expect(mgr.shouldEmitBugDetected()).toBe(false);
    });

    it('shouldEmitAdapted() → true only in smart mode', () => {
      const { mgr } = makeManager('smart');
      expect(mgr.shouldEmitAdapted()).toBe(true);
      mgr.setMode('debug');
      expect(mgr.shouldEmitAdapted()).toBe(false);
    });

    it('shouldEmitConsoleErrors() → true in debug and observe', () => {
      const { mgr } = makeManager('debug');
      expect(mgr.shouldEmitConsoleErrors()).toBe(true);
      mgr.setMode('observe');
      expect(mgr.shouldEmitConsoleErrors()).toBe(true);
      mgr.setMode('smart');
      expect(mgr.shouldEmitConsoleErrors()).toBe(false);
    });

    it('isObserveMode() → true only in observe', () => {
      const { mgr } = makeManager('observe');
      expect(mgr.isObserveMode()).toBe(true);
      mgr.setMode('smart');
      expect(mgr.isObserveMode()).toBe(false);
    });

    it('isSpeedMode() → true only in speed', () => {
      const { mgr } = makeManager('speed');
      expect(mgr.isSpeedMode()).toBe(true);
      mgr.setMode('smart');
      expect(mgr.isSpeedMode()).toBe(false);
    });

    it('isFullHumanMode() → true in smart and debug', () => {
      const { mgr } = makeManager('smart');
      expect(mgr.isFullHumanMode()).toBe(true);
      mgr.setMode('debug');
      expect(mgr.isFullHumanMode()).toBe(true);
      mgr.setMode('speed');
      expect(mgr.isFullHumanMode()).toBe(false);
    });
  });
});
