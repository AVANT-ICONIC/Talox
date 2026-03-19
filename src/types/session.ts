/**
 * @file session.ts
 * @description Types for observe-mode session reports.
 *
 * A `TaloxSessionReport` is generated automatically when the human closes the
 * browser during an observe session. It captures the full timeline of interactions,
 * all annotations, errors, and network failures — giving the agent complete context
 * without requiring the human to describe anything manually.
 */

import type { AnnotationEntry } from './annotation.js';
import type { TaloxNode } from './index.js';

// ─── Output Format ───────────────────────────────────────────────────────────

/**
 * Controls which output files are written when a session ends.
 *
 * - `'json'`     → machine-readable, for agent consumption
 * - `'markdown'` → human-readable, for paste-into-chat or PR comments
 * - `'both'`     → default; writes both files
 */
export type SessionOutputFormat = 'json' | 'markdown' | 'both';

// ─── Interaction ─────────────────────────────────────────────────────────────

/** The type of interaction recorded in the session timeline. */
export type InteractionType = 'click' | 'navigation' | 'input' | 'scroll' | 'rightclick';

/**
 * A single human interaction captured during an observe session.
 * Every interaction carries the page's AX context, any console errors and
 * network failures that occurred, and before/after screenshots.
 */
export interface TaloxInteraction {
  /** 1-based sequential index within the session. */
  index: number;
  /** Category of the interaction. */
  type: InteractionType;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Full URL of the page at the time of interaction. */
  url: string;
  /** The element that was interacted with (undefined for navigations). */
  element?: {
    tag: string;
    role?: string;
    /** Trimmed text content, capped at 120 characters. */
    text?: string;
    selector: string;
    boundingBox: { x: number; y: number; width: number; height: number };
  };
  /** AX-Tree snapshot of the interacted element at the time of the action. */
  axSnapshot?: TaloxNode;
  /** Console errors that appeared after this interaction. */
  consoleErrors: string[];
  /** Network failures that occurred after this interaction. */
  networkFailures: Array<{ url: string; status: number; type?: string }>;
  /** Base64-encoded PNG screenshot taken immediately before this interaction. */
  screenshotBefore?: string;
  /** Base64-encoded PNG screenshot taken immediately after this interaction. */
  screenshotAfter?: string;
}

// ─── Session Summary ─────────────────────────────────────────────────────────

/** Aggregated counts for the session report header. */
export interface TaloxSessionSummary {
  totalInteractions: number;
  totalAnnotations: number;
  totalConsoleErrors: number;
  totalNetworkFailures: number;
  /** Per-label annotation counts, e.g. `{ bug: 2, note: 1, 'my-tag': 3 }`. */
  annotationsByLabel: Record<string, number>;
}

// ─── Session Report ───────────────────────────────────────────────────────────

/**
 * The complete output of an observe session.
 * Written to disk as JSON and/or Markdown when the browser closes.
 */
export interface TaloxSessionReport {
  /** UUID v4 — unique per session run. */
  id: string;
  /** ISO 8601 timestamp when the session started. */
  startedAt: string;
  /** ISO 8601 timestamp when the session ended (browser close or explicit end). */
  endedAt: string;
  /** Total session duration in milliseconds. */
  durationMs: number;
  /** The URL the browser was on when the session started. */
  startUrl: string;
  /** Ordered list of all human interactions captured. */
  interactions: TaloxInteraction[];
  /** All annotations submitted by the human. */
  annotations: AnnotationEntry[];
  /** Aggregated counts. */
  summary: TaloxSessionSummary;
}

// ─── Options ─────────────────────────────────────────────────────────────────

/** Options passed to {@link ObserveSession} at launch time. */
export interface ObserveSessionOptions {
  /**
   * Which output files to generate on session end.
   * @default 'both'
   */
  output?: SessionOutputFormat;
  /**
   * Directory where session report files are written.
   * @default process.cwd() + '/talox-sessions'
   */
  outputDir?: string;

  // ── debug mode flags (also honoured when mode === 'observe') ────────────────

  /**
   * Show the browser window.
   * - `observe` mode: `true` by default (human needs to see the browser)
   * - `debug` mode: `false` by default (headless unless you opt in)
   *
   * @default true for observe, false for debug
   */
  headed?: boolean;

  /**
   * Enable the visual overlay — right-click context menu, element inspector,
   * and annotation modal. When `false`, only raw interaction/console/network
   * tracking runs (no UI injected into the page).
   *
   * - `observe` mode: `true` by default
   * - `debug` mode: `false` by default
   *
   * AI agents can set `overlay: true` in `debug` mode to drive the overlay
   * programmatically via `talox.evaluate()` without needing a headed browser.
   *
   * @default true for observe, false for debug
   */
  overlay?: boolean;

  /**
   * Write a session report (JSON + Markdown) to `outputDir` when `stop()` is
   * called or the browser closes. Automatically `true` when `overlay` is `true`.
   *
   * @default true for observe, false for debug
   */
  record?: boolean;
}
