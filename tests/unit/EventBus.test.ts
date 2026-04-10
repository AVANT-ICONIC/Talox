import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/controller/EventBus';

interface TestMap {
  foo: { value: number };
  bar: string;
  error: { message: string; stack?: string };
  noPayload: undefined;
}

describe('EventBus', () => {
  let bus: EventBus<TestMap>;

  beforeEach(() => {
    bus = new EventBus<TestMap>();
  });

  // ─── Existing basic coverage ────────────────────────────────────────────

  it('subscribes and receives events via on()', () => {
    const handler = vi.fn();
    bus.on('foo', handler);
    bus.emit('foo', { value: 42 });
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('unsubscribes via off()', () => {
    const handler = vi.fn();
    bus.on('foo', handler);
    bus.off('foo', handler);
    bus.emit('foo', { value: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('tracks listener counts', () => {
    bus.on('foo', () => {});
    bus.on('foo', () => {});
    expect(bus.listenerCount('foo')).toBe(2);
  });

  // ─── Missing branch coverage: off() count decrement (line 67) ──────────

  it('off() decrements listener count but does not go negative', () => {
    const handler = vi.fn();
    bus.on('foo', handler);
    expect(bus.listenerCount('foo')).toBe(1);
    bus.off('foo', handler);
    expect(bus.listenerCount('foo')).toBe(0);
    // Off again — should not go negative
    bus.off('foo', handler);
    expect(bus.listenerCount('foo')).toBe(0);
  });

  // ─── Missing branch coverage: emit() error handling (lines 84-93) ──────

  it('catches handler errors and re-emits as error event', () => {
    const errorHandler = vi.fn();
    bus.on('error', errorHandler);
    bus.on('foo' as any, (() => { throw new Error('boom'); }) as any);
    bus.emit('foo', { value: 1 });
    expect(errorHandler).toHaveBeenCalled();
    expect(errorHandler.mock.calls[0][0].message).toBe('boom');
  });

  it('catches handler errors and logs to stderr when no error listener', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('foo' as any, (() => { throw new Error('fail'); }) as any);
    bus.emit('foo', { value: 1 });
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain('[Talox EventBus]');
    consoleSpy.mockRestore();
  });

  it('catches non-Error throws and converts to string', () => {
    const errorHandler = vi.fn();
    bus.on('error', errorHandler);
    bus.on('foo' as any, (() => { throw 'string-error'; }) as any);
    bus.emit('foo', { value: 1 });
    expect(errorHandler).toHaveBeenCalled();
    expect(errorHandler.mock.calls[0][0].message).toBe('string-error');
  });

  it('does not infinitely loop when error handler itself throws on error event', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.on('error', (() => { throw new Error('nested'); }) as any);
    // Emitting 'error' event with a throwing handler — should not loop
    bus.emit('error', { message: 'test' });
    // The error handler throws, but since event === 'error', it logs to stderr
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ─── Missing branch coverage: once() (lines 102-110) ───────────────────

  it('subscribes with once() and auto-removes after first call', () => {
    const handler = vi.fn();
    bus.once('foo', handler);
    bus.emit('foo', { value: 1 });
    bus.emit('foo', { value: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('once() decrements listener count after firing', () => {
    bus.once('foo', () => {});
    expect(bus.listenerCount('foo')).toBe(1);
    bus.emit('foo', { value: 1 });
    expect(bus.listenerCount('foo')).toBe(0);
  });

  // ─── Missing branch coverage: removeListeners() (lines 142-144) ────────

  it('removeListeners() removes all listeners for a specific event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('foo', h1);
    bus.on('foo', h2);
    bus.on('bar', vi.fn());
    bus.removeListeners('foo');
    bus.emit('foo', { value: 1 });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
    expect(bus.listenerCount('foo')).toBe(0);
    expect(bus.listenerCount('bar')).toBe(1);
  });

  // ─── Missing branch coverage: removeAllListeners() (lines 134-136) ─────

  it('removeAllListeners() clears all events and counts', () => {
    bus.on('foo', () => {});
    bus.on('bar', () => {});
    bus.removeAllListeners();
    expect(bus.listenerCount('foo')).toBe(0);
    expect(bus.listenerCount('bar')).toBe(0);
    const counts = bus.getListenerCounts();
    expect(counts.size).toBe(0);
  });

  // ─── getListenerCounts returns a copy ──────────────────────────────────

  it('getListenerCounts() returns a snapshot Map', () => {
    bus.on('foo', () => {});
    const counts = bus.getListenerCounts();
    expect(counts.get('foo')).toBe(1);
    // Mutating the returned map does not affect the bus
    counts.set('foo', 999);
    expect(bus.listenerCount('foo')).toBe(1);
  });

  // ─── Events with undefined payload (elementChanged) ────────────────────

  it('handles events with undefined payload type', () => {
    const handler = vi.fn();
    bus.on('noPayload', handler);
    bus.emit('noPayload');
    expect(handler).toHaveBeenCalled();
  });
});
