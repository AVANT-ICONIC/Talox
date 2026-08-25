/**
 * @file events.ts
 * @description Fully typed event map for the Talox event system.
 *
 * Each key in `TaloxEventMap` is an event name; its value is the exact payload
 * type for that event. This gives TypeScript full inference through `EventBus<TaloxEventMap>`.
 */

import type { AnnotationEntry } from "./annotation.js";
import type { TaloxBug, TaloxPageState } from "./index.js";
import type { TaloxSettings } from "./settings.js";

// ─── Adaptive Runtime ────────────────────────────────────────────────────────

/**
 * The reason Talox's always-on adaptation engine changed runtime behavior.
 * Semantically distinct from `bugDetected` — this describes Talox's own
 * internal self-adjustment, not a problem with the website.
 */
export type AdaptationReason =
	| "bot_detection_soft" // Fingerprinting scripts or suspicious redirects detected
	| "bot_detection_hard" // CAPTCHA or hard block wall detected
	| "selector_miss" // Selector resolution failed — triggering semantic fallback
	| "page_timeout" // Page response too slow — reducing action pace
	| "rate_limit" // HTTP 429 received — backing off
	| "captcha_detected" // CAPTCHA variant detected — requires human or solver
	| "blocker_unresolvable_headless" // Blocker can't be resolved headlessly — escalate to headed
	| "blocker_resolved"; // Blocker resolved — can return to headless

/**
 * Payload for the `adapted` event.
 * Emitted when the always-on adaptation engine applies a settings change.
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

// ─── Observe Session Events ──────────────────────────────────────────────────

/**
 * Payload for the `sessionEnd` event.
 * Emitted by an active observe session when it is finalized.
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
 * Emitted by an active observe session when the human submits an annotation.
 */
export interface AnnotationAddedEvent {
	/** The annotation that was just added. */
	entry: AnnotationEntry;
	/** Current size of the annotation buffer (including this entry). */
	bufferSize: number;
}

/**
 * Payload for the `annotationUndone` event.
 * Emitted by an active observe session when the human presses Ctrl/Cmd+Z.
 */
export interface AnnotationUndoneEvent {
	/** The annotation that was removed. */
	removed: AnnotationEntry;
	/** Current size of the annotation buffer after removal. */
	bufferSize: number;
}

// ─── Human Takeover ──────────────────────────────────────────────────────────

/**
 * Semantic reason why agent control was handed to a human.
 * Use these instead of raw strings so callers can switch/match exhaustively.
 */
export type TakeoverReason =
	| "login-required" // Page requires credentials the agent doesn't have
	| "2fa-required" // Two-factor / OTP step reached
	| "captcha-present" // Unsolved CAPTCHA blocking progress
	| "agent-uncertain" // Agent confidence too low to proceed safely
	| "policy-blocked" // Action blocked by session policy
	| "challenge-unsolved" // Bot-detection challenge the agent cannot handle
	| "manual"; // Developer or test explicitly requested takeover

/**
 * Summary generated after a human takeover completes.
 * Attached to the `agentResumed` event so the agent can orient itself.
 */
export interface TakeoverSummary {
	/** Why the takeover was triggered. */
	reason: string;
	/** ISO timestamp when takeover was requested. */
	startedAt: string;
	/** ISO timestamp when agent resumed. */
	resumedAt: string;
	/** Duration of the takeover in milliseconds. */
	durationMs: number;
	/** Whether the takeover ended via timeout (true) or human action (false). */
	timedOut: boolean;
	/** What the agent was trying to do when takeover was requested. */
	agentIntent?: string;
	/** What changed during the takeover (URL, visible elements, etc.). */
	whatChanged?: string;
	/** Suggested next action for the agent after resume. */
	suggestedNextAction?: string;
}

// ─── Talox Event Map ─────────────────────────────────────────────────────────

/**
 * The complete typed event map for `EventBus<TaloxEventMap>`.
 *
 * @example
 * ```ts
 * talox.on('adapted', (e) => {
 *   console.log(`Talox adapted: ${e.reason} → ${e.strategy}`)
 * })
 *
 * talox.on('sessionEnd', (e) => {
 *   console.log(`Report at: ${e.reportPath}`)
 * })
 * ```
 */
export interface TaloxEventMap {
	// ── Core runtime ──────────────────────────────────────────────────────────
	/** Fired after every page navigation (goto, link click, redirect). */
	navigation: { url: string; title: string };
	/** Fired for internal Talox errors (not website errors). */
	error: { message: string; stack?: string };
	/** Fired when Talox publishes a new page-state snapshot. */
	stateChanged: TaloxPageState;
	/** Fired when a DOM element changes after an interaction. */
	elementChanged: undefined;

	// ── Diagnostic telemetry ─────────────────────────────────────────────────
	/** Console error captured from the page when diagnostic/observe telemetry is active. */
	consoleError: { error: string; url: string };
	/** Network request failure surfaced by observation telemetry. */
	networkError: { url: string; status: number; type?: string };
	/** Typed channel for a captured console warning. */
	consoleWarning: { warning: string; url: string };
	/** Typed channel for a captured console log. */
	consoleLog: { message: string; url: string };
	/** A layout/JS bug detected by the `RulesEngine` and surfaced through diagnostic telemetry. */
	bugDetected: TaloxBug;

	// ── Adaptive runtime ──────────────────────────────────────────────────────
	/**
	 * Talox changed runtime settings in response to an observed outcome.
	 * NOT a website bug — this is the always-on adaptation loop adjusting itself.
	 */
	adapted: AdaptedEvent;

	// ── Observe session ───────────────────────────────────────────────────────
	/** Human submitted an annotation via the overlay Comment Mode. */
	annotationAdded: AnnotationAddedEvent;
	/** Human pressed Ctrl/Cmd+Z — last annotation removed from buffer. */
	annotationUndone: AnnotationUndoneEvent;
	/** Observe session finalized — session report written to disk. */
	sessionEnd: SessionEndEvent;

	// ── Runtime controls & takeover ───────────────────────────────────────────
	/** Fired when verbosity level is changed via `setVerbosity()`. */
	verbosityChanged: { level: 0 | 1 | 2 | 3 };
	/** Fired when human takeover is requested. */
	humanTakeoverRequested: { reason?: string; timestamp: string };
	/** Fired when agent resumes after human takeover. */
	agentResumed: { reason: "timeout" | "manual"; summary?: TakeoverSummary };
	/** Fired when Talox auto-escalates from headless to headed browser operation. */
	headedEscalation: { reason: string; previousMode: "headless" | "headed" };
	/** Fired when Talox returns to headless browser operation after escalation. */
	headlessRestored: { reason: string };
	/** Fired when mouse coordinates are published for visual cursor synchronization. */
	cursorMoved: { x: number; y: number };
	/** Fired when the agent is about to perform a mouse action. */
	agentActing: undefined;
	/** Fired when the agent is waiting, reading, or processing. */
	agentThinking: undefined;
	/** Fired when a click happens at the given coordinates. */
	cursorClicked: { x: number; y: number };

	// ── Auto-dialog handling ─────────────────────────────────────────────────
	/** Fired when a browser dialog was automatically accepted or dismissed. */
	dialogHandled: { type: string; message: string; action: "accepted" | "dismissed" };

	// ── Session idle timeout ─────────────────────────────────────────────────
	/** Fired when the session has been idle longer than the configured timeout. */
	sessionIdle: { idleMs: number; timeoutMs: number; sessionId: string };

	// ── Autonomous Loop ─────────────────────────────────────────────────────
	/** Fired when an autonomous loop starts. */
	loopStarted: { goal: { description: string; startUrl?: string; maxIterations: number } };
	/** Fired after each loop iteration completes. */
	loopIteration: { iteration: number; observation: string; status: string };
	/** Fired when the loop creates a new skill from a blocker. */
	loopSkillCreated: { skillName: string; triggeredBy: string };
	/** Fired when the autonomous loop achieves its goal. */
	loopGoalAchieved: { totalIterations: number; totalCostUsd: number };
	/** Fired when the autonomous loop stops for any reason. */
	loopStopped: { reason: string; totalIterations: number };

	// ── Visual Reasoning ────────────────────────────────────────────────────
	/** Fired when Talox needs the hosting agent's vision to analyze a page screenshot. */
	visualQuestion: {
		id: string;
		question: string;
		image: {
			format: "base64" | "file" | "buffer";
			data: string;
		};
	};
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
