/**
 * @file InteractionQuality.ts
 * @description Real-time scoring of interaction fidelity — how "human-like"
 * Talox's automation appears to detection systems.
 *
 * Scores range 0–100 across four dimensions:
 * - **Mouse naturalness** — bezier curve quality, speed variance, pause patterns
 * - **Typing rhythm** — key interval variance, typo frequency, burst patterns
 * - **Scroll patterns** — smoothness, acceleration, pause-then-scroll
 * - **Click timing** — pre-click hover, post-click pause, double-click gaps
 *
 * The `QualityScore` is consumed by `AdaptationEngine` to validate whether
 * strategy adjustments (e.g. `mouseSpeed: 0.5 → 0.7`) actually improved
 * the interaction fidelity.
 */

import type { AccelerationCurve, MovementStyle, TypingRhythm } from "./controller/ActionExecutor.js";
import { createLogger } from "./Logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QualityDimensions {
	/** 0–100. Bezier smoothness, speed variance, natural pauses. */
	mouse: number;
	/** 0–100. Key interval variance, typo frequency, burst patterns. */
	typing: number;
	/** 0–100. Scroll smoothness, acceleration curves, pause-then-scroll. */
	scroll: number;
	/** 0–100. Pre-click hover duration, post-click pause, double-click gaps. */
	click: number;
}

export interface QualityScore {
	dimensions: QualityDimensions;
	/** Weighted average — all dimensions equally weighted. */
	overall: number;
	/** ISO timestamp of this scoring sample. */
	scoredAt: string;
}

export interface MouseMetrics {
	points: Array<{ x: number; y: number; timestampMs: number }>;
	movementStyle: MovementStyle;
	accelerationCurve: AccelerationCurve;
}

export interface TypingMetrics {
	keyIntervalsMs: number[];
	textLength: number;
	rhythm: TypingRhythm;
	typoCount: number;
}

export interface ScrollMetrics {
	scrollEvents: Array<{ deltaY: number; timestampMs: number }>;
	totalDistance: number;
}

export interface ClickMetrics {
	/** Time between mouse arrival and click in ms. */
	preClickHoverMs: number;
	/** Time after click before next action in ms. */
	postClickPauseMs: number;
	/** Time between double-click events in ms (0 if single click). */
	doubleClickGapMs: number;
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────

const log = createLogger("Quality");

/** Default neutral score — used when no metrics are available. */
const NEUTRAL: QualityDimensions = { mouse: 50, typing: 50, scroll: 50, click: 50 };

/**
 * Score mouse movement naturalness.
 *
 * High scores require:
 * - Bezier-curve-like nonlinear path (not straight lines)
 * - Variable speed (slow-down before target, not constant velocity)
 * - Natural pauses (not robotic intervals)
 */
export function scoreMouse(metrics: MouseMetrics): number {
	const { points, movementStyle, accelerationCurve } = metrics;
	if (points.length < 3) return 50; // Not enough data

	let score = 50;

	// 1. Movement style bonus
	switch (movementStyle) {
		case "smooth":
			score += 15; // Smooth bezier curves are most human-like
			break;
		case "precise":
			score += 5; // Precise is OK but slightly mechanical
			break;
		case "relaxed":
			score += 10; // Relaxed has natural variance
			break;
		case "jerky":
			score -= 10; // Too jerky looks like a script
			break;
	}

	// 2. Acceleration curve bonus
	switch (accelerationCurve) {
		case "ease-out":
			score += 10; // Deceleration before target is human-like
			break;
		case "ease-in-out":
			score += 8;
			break;
		case "bezier":
			score += 12;
			break;
		case "linear":
			score -= 15; // Linear movement is robotic
			break;
	}

	// 3. Speed variance — humans don't move at constant speed
	const durations: number[] = [];
	for (let i = 1; i < points.length; i++) {
		durations.push(points[i]!.timestampMs - points[i - 1]!.timestampMs);
	}
	const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
	if (avgDuration === 0) return Math.max(0, Math.min(100, score));

	const variance = durations.reduce((sum, d) => sum + (d - avgDuration) ** 2, 0) / durations.length;
	const cv = Math.sqrt(variance) / avgDuration; // Coefficient of variation
	if (cv > 0.2)
		score += 10; // Good variance
	else if (cv > 0.1) score += 5;
	else score -= 5; // Too consistent = robotic

	return Math.max(0, Math.min(100, score));
}

/**
 * Score typing rhythm naturalness.
 *
 * High scores require:
 * - Variable key intervals (not constant speed)
 * - Natural burst patterns (fast then slow)
 * - Realistic typo frequency
 */
export function scoreTyping(metrics: TypingMetrics): number {
	const { keyIntervalsMs, rhythm, typoCount, textLength } = metrics;
	if (keyIntervalsMs.length < 2) return 50;

	let score = 50;

	// 1. Rhythm bonus
	switch (rhythm) {
		case "variable":
			score += 15; // Variable rhythm is most human
			break;
		case "medium":
			score += 5;
			break;
		case "slow":
			score += 3;
			break;
		case "fast":
			score -= 10; // Too fast looks automated
			break;
	}

	// 2. Interval variance
	const avgInterval = keyIntervalsMs.reduce((a, b) => a + b, 0) / keyIntervalsMs.length;
	const variance = keyIntervalsMs.reduce((sum, i) => sum + (i - avgInterval) ** 2, 0) / keyIntervalsMs.length;
	const cv = Math.sqrt(variance) / avgInterval;
	if (cv > 0.3) score += 10;
	else if (cv > 0.15) score += 5;
	else score -= 5;

	// 3. Burst patterns — do we see fast bursts followed by pauses?
	let bursts = 0;
	for (let i = 1; i < keyIntervalsMs.length; i++) {
		if (keyIntervalsMs[i - 1]! < avgInterval * 0.5 && keyIntervalsMs[i]! > avgInterval * 1.5) {
			bursts++;
		}
	}
	if (bursts > 0) score += 5;

	// 4. Typo frequency — humans make ~2% typos
	if (textLength > 10) {
		const typoRate = typoCount / textLength;
		if (typoRate > 0.01 && typoRate < 0.05) score += 10;
		else if (typoRate > 0) score += 5;
	}

	return Math.max(0, Math.min(100, score));
}

/**
 * Score scroll pattern naturalness.
 *
 * High scores require:
 * - Variable scroll distances (not uniform)
 * - Natural pauses between scrolls
 * - Smooth acceleration/deceleration
 */
export function scoreScroll(metrics: ScrollMetrics): number {
	const { scrollEvents, totalDistance } = metrics;
	if (scrollEvents.length < 2 || totalDistance === 0) return 50;

	let score = 50;

	// 1. Distance variance
	const distances = scrollEvents.map((e) => Math.abs(e.deltaY));
	const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
	const variance = distances.reduce((sum, d) => sum + (d - avgDist) ** 2, 0) / distances.length;
	const cv = Math.sqrt(variance) / avgDist;
	if (cv > 0.3) score += 10;
	else if (cv > 0.15) score += 5;
	else score -= 5;

	// 2. Pause detection
	let pauses = 0;
	for (let i = 1; i < scrollEvents.length; i++) {
		const gap = scrollEvents[i]!.timestampMs - scrollEvents[i - 1]!.timestampMs;
		if (gap > 500) pauses++; // Natural pause between scroll bursts
	}
	if (pauses > 0 && pauses < scrollEvents.length) score += 10;

	// 3. Total distance — humans scroll in chunks, not huge single scrolls
	if (totalDistance < 5000) score += 5;
	else if (totalDistance < 15000) score += 3;

	return Math.max(0, Math.min(100, score));
}

/**
 * Score click timing naturalness.
 *
 * High scores require:
 * - Pre-click hover (humans pause before clicking)
 * - Post-click pause (processing time after click)
 * - Natural double-click gaps (150–500ms)
 */
export function scoreClick(metrics: ClickMetrics): number {
	const { preClickHoverMs, postClickPauseMs, doubleClickGapMs } = metrics;
	let score = 50;

	// 1. Pre-click hover — humans pause 100–300ms before clicking
	if (preClickHoverMs > 50 && preClickHoverMs < 500) score += 15;
	else if (preClickHoverMs > 0) score += 5;
	else score -= 10; // Instant click = bot

	// 2. Post-click pause — humans wait after clicking
	if (postClickPauseMs > 100 && postClickPauseMs < 1000) score += 10;
	else if (postClickPauseMs > 0) score += 3;

	// 3. Double-click gap — natural range is 150–500ms
	if (doubleClickGapMs > 0) {
		if (doubleClickGapMs > 100 && doubleClickGapMs < 600) score += 10;
		else score += 2; // Double-click exists but timing is off
	}

	return Math.max(0, Math.min(100, score));
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

/**
 * Compute an aggregated quality score from the four dimensions.
 * Defaults to the neutral score (50) for any dimension not provided.
 */
export function computeQuality(partial: Partial<QualityDimensions>): QualityScore {
	const dimensions: QualityDimensions = { ...NEUTRAL, ...partial };
	const overall = Math.round((dimensions.mouse + dimensions.typing + dimensions.scroll + dimensions.click) / 4);

	return {
		dimensions,
		overall,
		scoredAt: new Date().toISOString(),
	};
}

/**
 * Score a full interaction from raw metrics.
 */
export function scoreInteraction(
	mouse?: MouseMetrics,
	typing?: TypingMetrics,
	scroll?: ScrollMetrics,
	click?: ClickMetrics,
): QualityScore {
	const dims: Partial<QualityDimensions> = {};

	if (mouse) dims.mouse = scoreMouse(mouse);
	if (typing) dims.typing = scoreTyping(typing);
	if (scroll) dims.scroll = scoreScroll(scroll);
	if (click) dims.click = scoreClick(click);

	const result = computeQuality(dims);
	log.info(`Quality: ${result.overall}% (mouse:${dimensionsStr(dims)})`);
	return result;
}

function dimensionsStr(dims: Partial<QualityDimensions>): string {
	return [dims.mouse, dims.typing, dims.scroll, dims.click].map((d) => (d !== undefined ? `${d}` : "-")).join("/");
}

// ─── Session Tracking ─────────────────────────────────────────────────────────

/**
 * Session-level quality tracker that maintains a rolling average
 * and can report trends to the AdaptationEngine.
 */
export class QualityTracker {
	private samples: QualityScore[] = [];
	private readonly maxSamples: number;

	constructor(maxSamples = 50) {
		this.maxSamples = maxSamples;
	}

	/** Record a new quality sample. */
	push(score: QualityScore): void {
		this.samples.push(score);
		if (this.samples.length > this.maxSamples) {
			this.samples.shift();
		}
	}

	/** Get the current rolling average (0–100). */
	get overall(): number {
		if (this.samples.length === 0) return 50;
		const sum = this.samples.reduce((a, s) => a + s.overall, 0);
		return Math.round(sum / this.samples.length);
	}

	/** Get per-dimension rolling averages. */
	getDimensions(): QualityDimensions {
		if (this.samples.length === 0) return NEUTRAL;
		const dims = { mouse: 0, typing: 0, scroll: 0, click: 0 };
		for (const s of this.samples) {
			dims.mouse += s.dimensions.mouse;
			dims.typing += s.dimensions.typing;
			dims.scroll += s.dimensions.scroll;
			dims.click += s.dimensions.click;
		}
		return {
			mouse: Math.round(dims.mouse / this.samples.length),
			typing: Math.round(dims.typing / this.samples.length),
			scroll: Math.round(dims.scroll / this.samples.length),
			click: Math.round(dims.click / this.samples.length),
		};
	}

	/** Check if quality is trending up or down. */
	get trend(): "improving" | "declining" | "stable" {
		if (this.samples.length < 5) return "stable";
		const recent = this.samples.slice(-5).map((s) => s.overall);
		const slope = recent[4]! - recent[0]!;
		if (slope > 5) return "improving";
		if (slope < -5) return "declining";
		return "stable";
	}

	/** Reset all samples. */
	reset(): void {
		this.samples = [];
	}

	/** Number of samples collected. */
	get count(): number {
		return this.samples.length;
	}
}
