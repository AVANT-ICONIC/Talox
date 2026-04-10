import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TakeoverBridge } from '../../src/core/controller/TakeoverBridge';
import { EventBus } from '../../src/core/controller/EventBus';
import type { TaloxEventMap } from '../../src/types/events';

function makeBridge(timeoutMs = 0) {
  const bus = new EventBus<TaloxEventMap>();
  const bridge = new TakeoverBridge(bus, timeoutMs);
  return { bridge, bus };
}

function makePage() {
  return {
    addInitScript: vi.fn().mockResolvedValue(undefined),
    exposeFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TakeoverBridge', () => {
  describe('initial state', () => {
    it('starts in AGENT_RUNNING state', () => {
      const { bridge } = makeBridge();
      expect(bridge.getState()).toBe('AGENT_RUNNING');
    });
  });

  describe('initialize()', () => {
    it('does nothing when headed=false', async () => {
      const { bridge } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, false);
      expect(page.addInitScript).not.toHaveBeenCalled();
      expect(page.exposeFunction).not.toHaveBeenCalled();
    });

    it('injects overlay and exposes bridge when headed=true', async () => {
      const { bridge } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);
      expect(page.addInitScript).toHaveBeenCalledTimes(1);
      // exposeFunction called for __taloxBridge__ and __taloxCmd__
      expect(page.exposeFunction).toHaveBeenCalledWith('__taloxBridge__', expect.any(Function));
      expect(page.exposeFunction).toHaveBeenCalledWith('__taloxCmd__', expect.any(Function));
    });

    it('does not throw if exposeFunction rejects (already exposed)', async () => {
      const { bridge } = makeBridge();
      const page = {
        ...makePage(),
        exposeFunction: vi.fn().mockRejectedValue(new Error('already exposed')),
      };
      await expect(bridge.initialize(page as any, true)).resolves.toBeUndefined();
    });
  });

  describe('state machine', () => {
    it('transitions to WAITING_FOR_HUMAN on takeover', async () => {
      const { bridge, bus } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      const p = bridge.requestTakeover('test reason');
      // Give EventBus a tick
      await new Promise(r => setTimeout(r, 0));
      expect(bridge.getState()).toBe('WAITING_FOR_HUMAN');
      // Resume so promise doesn't hang
      bridge.resumeAgent();
      await p;
    });

    it('returns to AGENT_RUNNING after resumeAgent', async () => {
      const { bridge } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      bridge.resumeAgent(); // no-op when already running
      expect(bridge.getState()).toBe('AGENT_RUNNING');
    });

    it('emits humanTakeoverRequested with reason and timestamp', async () => {
      const { bridge, bus } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      const handler = vi.fn();
      bus.on('humanTakeoverRequested', handler);
      await bridge.requestTakeover('2fa-required');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: '2fa-required', timestamp: expect.any(String) }),
      );
      bridge.resumeAgent();
    });

    it('emits agentResumed with reason manual on resumeAgent', async () => {
      const { bridge, bus } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      const handler = vi.fn();
      bus.on('agentResumed', handler);
      bridge.resumeAgent();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ reason: 'manual' }));
    });
  });

  describe('timeout policy', () => {
    it('auto-resumes after timeoutMs when headed=true', async () => {
      vi.useFakeTimers();
      const { bridge, bus } = makeBridge(500);
      const page = makePage();
      await bridge.initialize(page as any, true);

      const resumeHandler = vi.fn();
      bus.on('agentResumed', resumeHandler);

      await bridge.requestTakeover('captcha');
      expect(bridge.getState()).toBe('WAITING_FOR_HUMAN');

      vi.advanceTimersByTime(600);
      await Promise.resolve();

      expect(resumeHandler).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
      vi.useRealTimers();
    });

    it('waits forever when timeoutMs=0', async () => {
      vi.useFakeTimers();
      const { bridge, bus } = makeBridge(0);
      const page = makePage();
      await bridge.initialize(page as any, true);

      const resumeHandler = vi.fn();
      bus.on('agentResumed', resumeHandler);

      await bridge.requestTakeover('login-required');
      vi.advanceTimersByTime(600_000); // 10 minutes
      await Promise.resolve();

      expect(resumeHandler).not.toHaveBeenCalled();
      bridge.resumeAgent(); // clean up
      vi.useRealTimers();
    });
  });

  describe('dispatchCmd', () => {
    it('calls page.evaluate with agent_paused on takeover', async () => {
      const { bridge } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      await bridge.requestTakeover();
      await new Promise(r => setTimeout(r, 0));
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'agent_paused');
      bridge.resumeAgent();
    });

    it('calls page.evaluate with agent_running on resume', async () => {
      const { bridge } = makeBridge();
      const page = makePage();
      await bridge.initialize(page as any, true);

      // Set state to WAITING first
      await bridge.requestTakeover();
      await new Promise(r => setTimeout(r, 0));
      page.evaluate.mockClear();

      bridge.resumeAgent();
      await new Promise(r => setTimeout(r, 0));
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'agent_running');
    });
  });

  describe('reinitialize()', () => {
    it('re-injects overlay for new page (SessionManager swap)', async () => {
      const { bridge } = makeBridge();
      const page1 = makePage();
      const page2 = makePage();

      await bridge.initialize(page1 as any, true);
      await bridge.reinitialize(page2 as any);

      expect(page2.addInitScript).toHaveBeenCalledTimes(1);
    });
  });
});
