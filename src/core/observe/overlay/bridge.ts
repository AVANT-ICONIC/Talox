/**
 * @file bridge.ts
 * @description Browser-side CDP bridge between the overlay UI and Node.js.
 *
 * This file runs INSIDE the browser page context (injected via addInitScript).
 * It is NOT Node.js code. All communication with the Talox Node.js process
 * happens through `window.__taloxEmit__()` which is exposed by Playwright's
 * `page.exposeFunction()` — a clean CDP channel, no polling, no WebSocket.
 *
 * The bridge also exposes `window.__talox__` as a read-only metadata object
 * that overlay scripts can inspect.
 */

// ─── Global Type Declarations ─────────────────────────────────────────────────

declare global {
  interface Window {
    /**
     * Exposed by Playwright's `page.exposeFunction('__taloxEmit__', handler)`.
     * Calling this sends an event from the browser page to the Node.js process.
     *
     * @param type    - The event type string (e.g. `'annotation:add'`)
     * @param payload - The serialisable event payload
     */
    __taloxEmit__: (type: string, payload: unknown) => Promise<void>;

    /** Read-only session metadata exposed to all overlay scripts. */
    __talox__: TaloxBridgeMeta;
  }
}

/** Metadata injected when the overlay is initialised. */
export interface TaloxBridgeMeta {
  /** Talox version string. */
  readonly version: string;
  /** UUID of the current observe session. */
  readonly sessionId: string;
  /** ISO 8601 timestamp when the session started. */
  readonly startedAt: string;
}

// ─── Bridge ──────────────────────────────────────────────────────────────────

/**
 * Send an event from the browser context to the Talox Node.js process.
 *
 * If `__taloxEmit__` is not yet available (e.g. called too early during init),
 * the call is queued and retried after a 100ms delay.
 *
 * @param type    - Event type. Convention: `'domain:action'` (e.g. `'annotation:add'`)
 * @param payload - JSON-serialisable event payload.
 */
export function taloxEmit(type: string, payload: unknown = {}): void {
  if (typeof window.__taloxEmit__ === 'function') {
    window.__taloxEmit__(type, payload).catch((err: unknown) => {
      console.warn('[Talox Bridge] Emit failed:', err);
    });
  } else {
    // Retry once after 100ms — covers the brief window before exposeFunction fires
    setTimeout(() => {
      if (typeof window.__taloxEmit__ === 'function') {
        window.__taloxEmit__(type, payload).catch((err: unknown) => {
          console.warn('[Talox Bridge] Emit (retry) failed:', err);
        });
      }
    }, 100);
  }
}

/**
 * Initialise the `window.__talox__` metadata object.
 * Called once by `OverlayInjector` during page init.
 */
export function initBridge(meta: TaloxBridgeMeta): void {
  Object.defineProperty(window, '__talox__', {
    value:        Object.freeze(meta),
    writable:     false,
    configurable: false,
    enumerable:   false,
  });
}
