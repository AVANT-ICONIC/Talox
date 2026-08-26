/**
 * @file PerceptionStack.ts
 * @description Composable perception stack for Talox.
 *
 * Separates page perception into five named layers, assembled into
 * three presets that trade cost against completeness:
 *
 * Layers:
 * - `structural`   AX tree + interactive elements (AX snapshot)
 * - `network`      Console errors + failed HTTP requests
 * - `bugs`         RulesEngine structural diff + layout bug analysis
 * - `challenge`    ChallengeDetector scan (Cloudflare, CAPTCHA, walls…)
 * - `screenshot`   Full-page PNG capture (only on demand)
 *
 * Presets:
 * ┌────────┬───────────┬─────────┬───────┬───────────┬────────────┐
 * │ Preset │ structural│ network │ bugs  │ challenge │ screenshot │
 * ├────────┼───────────┼─────────┼───────┼───────────┼────────────┤
 * │ cheap  │     ✓     │    ✗    │   ✗   │     ✗     │     ✗      │
 * │ medium │     ✓     │    ✓    │   ✗   │     ✓     │     ✗      │
 * │ heavy  │     ✓     │    ✓    │   ✓   │     ✓     │     ✓      │
 * └────────┴───────────┴─────────┴───────┴───────────┴────────────┘
 *
 * Session-level caching:
 * `PerceptionStack` caches the last perception result per (url, preset). The
 * cache is invalidated any time `invalidate()` is called — which `ActionExecutor`
 * does automatically after every state-changing action.
 *
 * @example
 * ```ts
 * const stack = new PerceptionStack(collector, challengeDetector);
 *
 * // Fast check after navigation — only AX tree
 * const cheapState = await stack.collect('cheap');
 *
 * // Full analysis before a complex decision
 * const heavyState = await stack.collect('heavy', { rulesEngine });
 *
 * // After clicking, invalidate so next collect is fresh
 * stack.invalidate();
 * ```
 */

import type { TaloxPageState } from "../types/index.js";
import type { ChallengeDetector, ChallengeState } from "./ChallengeDetector.js";
import type { PageStateCollector } from "./PageStateCollector.js";
import { askVisual, getScopedVisualEmitter } from "./VisualReasoner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerceptionPreset = "cheap" | "medium" | "heavy";

export interface PerceptionLayerFlags {
	/** Collect AX tree + interactive elements. Always true — required for all presets. */
	structural: boolean;
	/** Collect console errors + failed HTTP requests. */
	network: boolean;
	/** Run RulesEngine structural diff + layout bug analysis. */
	bugs: boolean;
	/** Run ChallengeDetector scan. */
	challenge: boolean;
	/** Capture full-page PNG capture. */
	screenshot: boolean;
}

/** A `TaloxPageState` annotated with perception metadata. */
export interface PerceivedState extends TaloxPageState {
	/** Which preset was used to collect this state. */
	perceptionPreset: PerceptionPreset;
	/** Which layers were active. */
	perceptionLayers: PerceptionLayerFlags;
	/** ChallengeDetector result, present if `challenge` layer was active. */
	challengeState?: ChallengeState;
	/** Base64-encoded full-page PNG, present if `screenshot` layer was active. */
	screenshotBase64?: string;
	/** ISO timestamp of when this perception was collected. */
	perceivedAt: string;
}

export interface PerceptionCollectOptions {
	/**
	 * Optional RulesEngine for bug detection (needed when `bugs` layer is active).
	 * If not provided and preset is `heavy`, bug layer is skipped silently.
	 */
	rulesEngine?: { analyze(state: TaloxPageState): any[]; diffStructural?(a: TaloxPageState, b: TaloxPageState): any[] };
	/** Last state for structural diff (passed to `rulesEngine.diffStructural` if provided). */
	previousState?: TaloxPageState | null;
	/** Override which layers to run, ignoring the preset defaults. */
	layers?: Partial<PerceptionLayerFlags>;
}

// ─── Preset Definitions ───────────────────────────────────────────────────────

export const PERCEPTION_PRESETS: Record<PerceptionPreset, PerceptionLayerFlags> = {
	cheap: {
		structural: true,
		network: false,
		bugs: false,
		challenge: false,
		screenshot: false,
	},
	medium: {
		structural: true,
		network: true,
		bugs: false,
		challenge: true,
		screenshot: false,
	},
	heavy: {
		structural: true,
		network: true,
		bugs: true,
		challenge: true,
		screenshot: true,
	},
};

// ─── PerceptionStack ──────────────────────────────────────────────────────────

/**
 * Composable wrapper around `PageStateCollector` that assembles perception
 * into presets and caches results within a single agent action cycle.
 *
 * The cache key is `${url}::${preset}`. It is invalidated by any call to
 * `invalidate()`, which should happen after every action that changes page state.
 */
export class PerceptionStack {
	/**
	 * Monotonically increasing counter. Incremented on every `invalidate()`.
	 * Used as the cache scope — all cache keys include this tick, so a single
	 * `invalidate()` effectively invalidates all entries without clearing the map.
	 */
	private sessionTick = 0;
	private readonly cache = new Map<string, PerceivedState>();

	constructor(
		private readonly collector: PageStateCollector,
		private readonly challengeDetector: ChallengeDetector | null = null,
	) {}

	// ─── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Collect a perception snapshot at the given preset level.
	 *
	 * Returns a cached result if this preset was already collected since the
	 * last `invalidate()` call — without calling the underlying collector again.
	 */
	private applyBugLayer(
		state: PerceivedState,
		layers: PerceptionLayerFlags,
		options: PerceptionCollectOptions,
		baseState: TaloxPageState,
	): void {
		if (!layers.bugs || !options.rulesEngine) {
			state.bugs = [];
			return;
		}
		const ruleBugs = options.rulesEngine.analyze(baseState);
		const diffBugs =
			options.previousState && options.rulesEngine.diffStructural
				? options.rulesEngine.diffStructural(options.previousState, baseState)
				: [];
		state.bugs = [...(state.bugs ?? []), ...ruleBugs, ...diffBugs];
	}

	private async applyScreenshotLayer(state: PerceivedState): Promise<void> {
		try {
			const page = this.collector.getPage();
			if (page && typeof page.screenshot === "function") {
				const buf: Buffer = await page.screenshot({ type: "png", fullPage: true });
				state.screenshotBase64 = buf.toString("base64");
			}
		} catch {
			// Non-fatal — screenshot unavailable
		}
	}

	/**
	 * Ask a visual question about the current page.
	 * Requires a `VisualReasoner` to be registered via `setVisualReasoner()`.
	 * Returns null if no reasoner is available or it fails.
	 *
	 * @param question Natural-language question (e.g. "What is the main heading?")
	 * @returns Answer string or null
	 */
	async askVisual(question: string): Promise<string | null> {
		try {
			const page = this.collector.getPage();
			if (!page) return null;
			const screenshot = await page.screenshot({ type: "png", fullPage: false });
			return await askVisual(screenshot, question, 15_000, getScopedVisualEmitter(this.collector));
		} catch {
			return null;
		}
	}

	async collect(preset: PerceptionPreset, options: PerceptionCollectOptions = {}): Promise<PerceivedState> {
		const cacheKey = `${this.sessionTick}::${preset}`;

		if (this.cache.has(cacheKey)) {
			return this.cache.get(cacheKey)!;
		}

		const baseState = await this.collector.collect();

		const layers = this.resolveLayerFlags(preset, options.layers);
		const perceivedAt = new Date().toISOString();

		// Start from the base state (structural + network already collected by collector)
		const state: PerceivedState = {
			...baseState,
			perceptionPreset: preset,
			perceptionLayers: layers,
			perceivedAt,
		};

		// If network layer is off, strip network data (cheap preset)
		if (!layers.network) {
			state.console = { errors: [] };
			state.network = { failedRequests: [] };
		}

		this.applyBugLayer(state, layers, options, baseState);

		// Challenge layer
		if (layers.challenge && this.challengeDetector) {
			state.challengeState = this.challengeDetector.analyze(baseState);
		}

		// Screenshot layer
		if (layers.screenshot) {
			await this.applyScreenshotLayer(state);
		}

		this.cache.set(cacheKey, state);
		return state;
	}

	/**
	 * Invalidate the cache. Call after any action that changes page state
	 * (click, type, navigate, etc.).
	 */
	invalidate(): void {
		this.sessionTick++;
		this.cache.clear();
	}

	/**
	 * Return true if a cached result exists for the given preset in the current
	 * session tick. The `url` parameter is accepted for API symmetry but the
	 * cache is tick-scoped, not URL-scoped.
	 */
	isCached(_url: string, preset: PerceptionPreset): boolean {
		return this.cache.has(`${this.sessionTick}::${preset}`);
	}

	/**
	 * Return the number of cached entries.
	 */
	get cacheSize(): number {
		return this.cache.size;
	}

	// ─── Helpers ──────────────────────────────────────────────────────────────

	private resolveLayerFlags(preset: PerceptionPreset, overrides?: Partial<PerceptionLayerFlags>): PerceptionLayerFlags {
		const base = { ...PERCEPTION_PRESETS[preset] };
		if (overrides) {
			return { ...base, ...overrides };
		}
		return base;
	}
}
