/**
 * @file events.ts
 * @description Fully typed event map for the Talox event system.
 *
 * Each key in `TaloxEventMap` is an event name; its value is the exact payload
 * type for that event. This gives TypeScript full inference through `EventBus<TaloxEventMap>`.
 *
 * ### Event emission rules by mode
 *
 * | Event              | smart | speed | debug | observe |
 * |--------------------|-------|-------|-------|---------|
 * | `navigation`       |   ✅  |  ✅   |  ✅   |   ✅    |
 * | `stateChanged`     |   ✅  |  ✅   |  ✅   |   —     |
 * | `modeChanged`      |   ✅  |  ✅   |  ✅   |   ✅    |
 * | `error`            |   ✅  |  ✅   |  ✅   |   ✅    |
 * | `consoleError`     |   —   |  —    |  ✅   |   ✅    |
 * | `consoleWarning`   |   —   |  —    |  ✅   |   —     |
 * | `consoleLog`       |   —   |  —    |  ✅   |   —     |
 * | `networkError`     |   —   |  —    |  ✅   |   ✅    |
 * | `bugDetected`      |   —   |  —    |  ✅   |   —     |
 * | `adapted`          |   ✅  |  —    |  —    |   —     |
 * | `annotationAdded`  |   —   |  —    |  —    |   ✅    |
 * | `annotationUndone` |   —   |  —    |  —    |   ✅    |
 * | `sessionEnd`       |   —   |  —    |  —    |   ✅    |
 *
 * Events not listed as emitted in a given mode are still **collected** into
 * `TaloxPageState` — they are simply not broadcast as events.
 */

import type { TaloxMode, TaloxSettings } from './index.js';
import type { TaloxPageState, TaloxBug } from './index.js';
import type { AnnotationEntry } from './annotation.js';

// ─── Smart Mode: Adaptation ──────────────────────────────────────────────────

/**
 * The reason `smart` mode triggered an adaptation.
 * Semantically distinct from `bugDetected` — this describes Talox's own
 * internal self-adjustment, not a problem with the website.
 */
export type AdaptationReason =
  | 'bot_detection_soft'   // Fingerprinting scripts or suspicious redirects detected
  | 'bot_detection_hard'   // CAPTCHA or hard block wall detected
  | 'selector_miss'        // Selector resolution failed — triggering semantic fallback
  | 'page_timeout'         // Page response too slow — reducing action pace
  | 'rate_limit'           // HTTP 429 received — backing off
  | 'captcha_detected';    // CAPTCHA variant detected — requires human or solver

/**
 * Payload for the `adapted` event.
 * Emitted only in `smart` mode when the adaptation engine changes settings.
 */
export interface AdaptedEvent {
  /** What triggered the adaptation. */
  reason: AdaptationReason;
  /** Human-readable name of the strategy applied, e.g. `'stealth_escalation'`. */
  strategy: string;
  /** Settings snapshot before the adaptation. */
  from: Partial<TaloxSettings>;
  /** Settings snapshot after the adaptation. */
  to: Partial<TaloxSettings>;
}

// ─── Observe Mode: Session ───────────────────────────────────────────────────

/**
 * Payload for the `sessionEnd` event.
 * Emitted only in `observe` mode when the human closes the browser or calls endSession().
 */
export interface SessionEndEvent {
  /** UUID of the session that just ended. */
  sessionId: string;
  /**
   * Absolute path to the generated report file.
   * If `output: 'both'`, this points to the JSON file.
   */
  reportPath: string;
  /** Total session duration in milliseconds. */
  durationMs: number;
  /** Number of interactions captured. */
  interactionCount: number;
  /** Number of annotations submitted. */
  annotationCount: number;
}

/**
 * Payload for the `annotationAdded` event.
 * Emitted only in `observe` mode when the human submits an annotation.
 */
export interface AnnotationAddedEvent {
  /** The annotation that was just added. */
  entry: AnnotationEntry;
  /** Current size of the annotation buffer (including this entry). */
  bufferSize: number;
}

/**
 * Payload for the `annotationUndone` event.
 * Emitted only in `observe` mode when the human presses Ctrl/Cmd+Z.
 */
export interface AnnotationUndoneEvent {
  /** The annotation that was removed. */
  removed: AnnotationEntry;
  /** Current size of the annotation buffer after removal. */
  bufferSize: number;
}

// ─── Talox Event Map ─────────────────────────────────────────────────────────

/**
 * The complete typed event map for `EventBus<TaloxEventMap>`.
 *
 * @example
 * ```ts
 * talox.on('adapted', (e) => {
 *   console.log(`Smart mode adjusted: ${e.reason} → ${e.strategy}`)
 * })
 *
 * talox.on('sessionEnd', (e) => {
 *   console.log(`Report at: ${e.reportPath}`)
 * })
 * ```
 */
export interface TaloxEventMap {
  // ── Available in all modes ────────────────────────────────────────────────
  /** Fired after every page navigation (goto, link click, redirect). */
  navigation:       { url: string; title: string };
  /** Fired when the execution mode is changed via `setMode()`. */
  modeChanged:      { mode: TaloxMode; settings: TaloxSettings };
  /** Fired for internal Talox errors (not website errors). */
  error:            { message: string; stack?: string };

  // ── smart + speed + debug ─────────────────────────────────────────────────
  /** Fired after every interaction that produces a new `TaloxPageState`. */
  stateChanged:     TaloxPageState;
  /** Fired when a DOM element changes after an interaction. */
  elementChanged:   undefined;

  // ── debug + observe ───────────────────────────────────────────────────────
  /** Console error captured from the page. Silent in smart/speed modes. */
  consoleError:     { error: string; url: string };
  /** Network request failure captured from the page. Silent in smart/speed modes. */
  networkError:     { url: string; status: number; type?: string };

  // ── debug only ────────────────────────────────────────────────────────────
  /** Console warning from the page. Debug mode only. */
  consoleWarning:   { warning: string; url: string };
  /** Console log from the page. Debug mode only. */
  consoleLog:       { message: string; url: string };
  /**
   * A layout/JS bug detected by the `RulesEngine`.
   * **Debug mode only** — in all other modes bugs are collected into
   * `TaloxPageState.bugs` silently without emitting this event.
   */
  bugDetected:      TaloxBug;

  // ── smart only ────────────────────────────────────────────────────────────
  /**
   * Smart mode changed its own settings in response to an outcome.
   * NOT a website bug — this is Talox adjusting itself.
   */
  adapted:          AdaptedEvent;

  // ── observe only ─────────────────────────────────────────────────────────
  /** Human submitted an annotation via the overlay Comment Mode. */
  annotationAdded:  AnnotationAddedEvent;
  /** Human pressed Ctrl/Cmd+Z — last annotation removed from buffer. */
  annotationUndone: AnnotationUndoneEvent;
  /** Browser closed or endSession() called — session report written to disk. */
  sessionEnd:       SessionEndEvent;
}

/** Union of all event names. */
export type TaloxEventType = keyof TaloxEventMap;

/**
 * A generic Talox event envelope (legacy shape — kept for backwards compat).
 * New code should use the typed payloads from `TaloxEventMap` directly.
 */
export interface TaloxEvent {
  type: TaloxEventType;
  timestamp: string;
  data?: unknown;
}
