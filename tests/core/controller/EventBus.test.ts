import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../../src/core/controller/EventBus';

// Minimal event map for testing
interface TestEvents {
  ping:    { value: number };
  pong:    { reply: string };
  nodata:  undefined;
}

describe('EventBus', () => {
  it('emits an event and invokes the correct handler', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.emit('ping', { value: 42 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('does not invoke handler for a different event', () => {
    const bus = new EventBus<TestEvents>();
    const pingHandler = vi.fn();
    const pongHandler = vi.fn();

    bus.on('ping', pingHandler);
    bus.on('pong', pongHandler);
    bus.emit('ping', { value: 1 });

    expect(pingHandler).toHaveBeenCalledOnce();
    expect(pongHandler).not.toHaveBeenCalled();
  });

  it('off() removes the listener', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.off('ping', handler);
    bus.emit('ping', { value: 99 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires exactly once and auto-removes', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.once('ping', handler);
    bus.emit('ping', { value: 1 });
    bus.emit('ping', { value: 2 });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('getListenerCounts() tracks active listeners', () => {
    const bus = new EventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('ping', h1);
    bus.on('ping', h2);
    bus.on('pong', h1);

    const counts = bus.getListenerCounts();
    expect(counts.get('ping')).toBe(2);
    expect(counts.get('pong')).toBe(1);
  });

  it('removeAllListeners() clears all handlers and counts', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();

    bus.on('ping', handler);
    bus.on('pong', vi.fn());
    bus.removeAllListeners();

    bus.emit('ping', { value: 7 });
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getListenerCounts().size).toBe(0);
  });

  it('does not propagate exceptions thrown by a listener', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('ping', () => { throw new Error('listener exploded'); });

    // Should not throw
    expect(() => bus.emit('ping', { value: 0 })).not.toThrow();
  });

  it('multiple handlers all receive the same payload', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.on('ping', (e) => received.push(e.value));
    bus.on('ping', (e) => received.push(e.value * 10));
    bus.emit('ping', { value: 3 });

    expect(received).toEqual([3, 30]);
  });
});
