/**
 * @file EventBus.ts
 * @description Fully typed EventEmitter wrapper for Talox.
 *
 * `EventBus<TMap>` wraps Node.js `EventEmitter` with a generic event map,
 * providing compile-time enforcement of event names and payload shapes.
 * All handler calls are wrapped in try/catch so a misbehaving listener
 * never crashes the controller.
 */

import { EventEmitter } from 'events';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A typed event handler function. */
export type EventHandler<T> = T extends undefined
  ? () => void
  : (data: T) => void;

// ─── EventBus ────────────────────────────────────────────────────────────────

/**
 * A generic, fully typed event bus backed by Node.js `EventEmitter`.
 *
 * @typeParam TMap - An object type mapping event names → payload types.
 *
 * @example
 * ```ts
 * import type { TaloxEventMap } from '../../types/index.js';
 *
 * const bus = new EventBus<TaloxEventMap>();
 *
 * bus.on('adapted', (e) => console.log(e.reason));  // ✅ typed
 * bus.on('adapted', (e) => console.log(e.unknown)); // ❌ TS error
 * ```
 */
export class EventBus<TMap extends object> {
  private readonly emitter: EventEmitter;
  /** Tracks the number of active listeners per event for `getListenerCounts()`. */
  private readonly counts: Map<keyof TMap, number>;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50); // generous limit for complex agent pipelines
    this.counts = new Map();
  }

  // ─── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to an event.
   * The handler receives the fully typed payload for that event.
   */
  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.emitter.on(event as string, handler as (...args: unknown[]) => void);
    this.counts.set(event, (this.counts.get(event) ?? 0) + 1);
  }

  // ─── Unsubscribe ───────────────────────────────────────────────────────────

  /**
   * Unsubscribe a specific handler from an event.
   */
  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.emitter.off(event as string, handler as (...args: unknown[]) => void);
    const current = this.counts.get(event) ?? 0;
    if (current > 0) this.counts.set(event, current - 1);
  }

  // ─── Emit ──────────────────────────────────────────────────────────────────

  /**
   * Emit an event with its typed payload.
   * All listeners are called synchronously. Errors thrown by listeners are
   * caught and re-emitted as `'error'` events (if any listener is registered),
   * or logged to stderr — they never propagate to the caller.
   */
  emit<K extends keyof TMap>(
    event: K,
    ...[data]: TMap[K] extends undefined ? [] : [TMap[K]]
  ): void {
    try {
      this.emitter.emit(event as string, data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack   = err instanceof Error ? err.stack   : undefined;

      // Avoid infinite loop: only re-emit 'error' if this isn't already 'error'
      if (event !== 'error' && this.emitter.listenerCount('error') > 0) {
        this.emitter.emit('error', { message, stack });
      } else {
        console.error(`[Talox EventBus] Unhandled error in '${String(event)}' listener:`, err);
      }
    }
  }

  // ─── One-time Subscription ─────────────────────────────────────────────────

  /**
   * Subscribe to an event exactly once — handler is removed after the first call.
   */
  once<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    const wrapped = (data: TMap[K]) => {
      const current = this.counts.get(event) ?? 0;
      if (current > 0) this.counts.set(event, current - 1);
      (handler as (d: TMap[K]) => void)(data);
    };
    this.emitter.once(event as string, wrapped as (...args: unknown[]) => void);
    this.counts.set(event, (this.counts.get(event) ?? 0) + 1);
  }

  // ─── Introspection ─────────────────────────────────────────────────────────

  /**
   * Returns the number of active listeners for each event type.
   * Useful for debugging and test assertions.
   */
  getListenerCounts(): Map<keyof TMap, number> {
    return new Map(this.counts);
  }

  /**
   * Returns the number of active listeners for a specific event.
   */
  listenerCount<K extends keyof TMap>(event: K): number {
    return this.counts.get(event) ?? 0;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Remove all event listeners and reset listener counts.
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
    this.counts.clear();
  }

  /**
   * Remove all listeners for a specific event.
   */
  removeListeners<K extends keyof TMap>(event: K): void {
    this.emitter.removeAllListeners(event as string);
    this.counts.delete(event);
  }
}
