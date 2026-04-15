/**
 * @file AdaptationEngine.ts
 * @description Always-on outcome-feedback loop for Talox.
 *
 * `AdaptationEngine` is called after every interaction.
 * It delegates detection to `BotDetector`, selects the appropriate strategy
 * from the registry, applies the settings patch directly, fires the
 * `adapted` event, and handles any required side effects.
 *
 * This class is the only place in the codebase that emits `'adapted'` events.
 */

import type { AdaptationReason, TaloxEventMap } from "../../types/events.js";
import type { TaloxPageState } from "../../types/index.js";
import type { TaloxSettings } from "../../types/settings.js";
import type { EventBus } from "../controller/EventBus.js";
import { BotDetector } from "./BotDetector.js";
import { DomainMemory } from "./DomainMemory.js";
import { type AdaptationSideEffect, STRATEGIES } from "./strategies.js";

// ─── AdaptationEngine ────────────────────────────────────────────────────────

/**
 * Runs the outcome feedback loop after every agent interaction.
 *
 * Flow:
 * ```
 * interaction completes
 *   → evaluate(state) called
 *   → BotDetector.detect(state) → reason | null
 *   → if reason: select strategy, patch settings, emit 'adapted'
 *   → handle side effects (UA rotation, etc.)
 * ```
 */
export class AdaptationEngine {
	private readonly detector: BotDetector;
	private settings: TaloxSettings;
	private readonly eventBus: EventBus<TaloxEventMap>;
	private readonly onEscalation: (() => Promise<void>) | undefined;
	private readonly bypassEscalation: boolean;

	/** Tracks whether semantic self-healing is currently forced on. */
	private semanticHealingActive: boolean = false;

	/** Set to true when mode was auto-escalated from debug/speed → smart. */
	private escalated: boolean = false;

	/** Rotating index for user-agent selection. */
	private uaIndex: number = 0;

	/** Tracks whether we're in headed mode after escalation. */
	private headedEscalated: boolean = false;

	private lastAdaptation: any = null;

	/** Per-domain strategy outcome memory — shared across evaluate() calls. */
	readonly domainMemory = new DomainMemory();

	private readonly userAgents: readonly string[] = [
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
	] as const;

	constructor(
		settings: TaloxSettings,
		eventBus: EventBus<TaloxEventMap>,
		onEscalation?: () => Promise<void>,
		bypassEscalation = false,
	) {
		this.detector = new BotDetector();
		this.settings = settings;
		this.eventBus = eventBus;
		this.onEscalation = onEscalation;
		this.bypassEscalation = bypassEscalation;
	}

	getLastAdaptation(): any {
		return this.lastAdaptation;
	}

	// ─── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Evaluate a page state after an interaction.
	 * If a bot-detection signal is found, applies the matching strategy and
	 * emits the `adapted` event. No-op if the page appears clean.
	 *
	 * @param state - The `TaloxPageState` returned by the last interaction.
	 */
	async evaluate(state: TaloxPageState): Promise<boolean> {
		const reason = this.detector.detect(state);
		if (!reason) return false;

		const strategy = STRATEGIES[reason];
		if (!strategy) return false;

		if (this.shouldBypassEscalation(reason)) {
			console.info(`[Talox Smart] Skipping auto escalation (${reason}) because bypass is enabled.`);
			return false;
		}

		const before = { ...this.settings };

		if (strategy.settingsPatch) {
			Object.assign(this.settings, strategy.settingsPatch);
		}

		const after = { ...this.settings };

		this.lastAdaptation = { reason, strategy: strategy.name, before, after };

		// Emit the typed adapted event — agent gets full transparency
		this.eventBus.emit("adapted", {
			reason,
			strategy: strategy.name,
			from: before,
			to: after,
		});

		// Handle headed/headless escalation events
		if (strategy.name === "escalate_to_headed") {
			this.headedEscalated = true;
			this.eventBus.emit("headedEscalation", {
				reason,
				previousMode: this.settings.headed ? "headed" : "headless",
			});
		} else if (strategy.name === "de_escalate_to_headless") {
			this.headedEscalated = false;
			this.eventBus.emit("headlessRestored", {
				reason,
			});
		}

		console.info(`[Talox Smart] Adapted: ${strategy.name} (${strategy.description})`);

		// Record outcome in domain memory (initial record = strategy fired, success TBD on next eval)
		// A second evaluate() with no detection signal on the same URL = implicit success
		this.domainMemory.record(state.url, strategy.name, false /* pending — updated on next clean eval */);

		// Handle side effects
		if (strategy.sideEffect) {
			await this.handleSideEffect(strategy.sideEffect);
		}

		return true;
	}

	/**
	 * Record that the last applied strategy succeeded on `url`.
	 * Call this when an action completes without triggering a new bot-detection
	 * signal — it updates the domain memory EWMA for the previously fired strategy.
	 */
	recordStrategySuccess(url: string): void {
		if (!this.lastAdaptation?.strategy) return;
		this.domainMemory.record(url, this.lastAdaptation.strategy, true);
	}

	/**
	 * Returns `true` if the engine auto-escalated during the last `evaluate()` call.
	 * Resets after being read.
	 */
	wasEscalated(): boolean {
		const v = this.escalated;
		this.escalated = false;
		return v;
	}

	/**
	 * Returns `true` if semantic self-healing has been activated by a
	 * `selector_miss` adaptation. The `ActionExecutor` checks this flag
	 * before attempting direct selector resolution.
	 */
	isSemanticHealingActive(): boolean {
		return this.semanticHealingActive;
	}

	/**
	 * Reset semantic healing flag after it has been used.
	 * Called by `ActionExecutor` after a successful self-healed interaction.
	 */
	resetSemanticHealing(): void {
		this.semanticHealingActive = false;
	}

	/**
	 * Returns the next user agent string in the rotation.
	 * Called during `rotate_user_agent` side effect handling.
	 */
	getNextUserAgent(): string {
		const ua = this.userAgents[this.uaIndex % this.userAgents.length];
		this.uaIndex++;
		return ua ?? this.userAgents[0]!;
	}

	// ─── Private ─────────────────────────────────────────────────────────────────

	private async handleSideEffect(effect: AdaptationSideEffect): Promise<void> {
		switch (effect) {
			case "rotate_user_agent":
				// Logged here; actual UA rotation requires browser restart which is
				// outside the engine's scope. The agent receives the adapted event
				// and can call talox.stop() + talox.launch() with the new UA if needed.
				console.info(`[Talox Smart] UA rotation suggested. Next agent: ${this.getNextUserAgent()}`);
				break;

			case "enable_semantic_healing":
				this.semanticHealingActive = true;
				console.info("[Talox Smart] Semantic self-healing activated for next action.");
				break;

			case "emit_captcha_event":
				// CAPTCHA events surface as adapted events with reason 'captcha_detected'.
				// The agent is responsible for solving or surfacing to the user.
				console.warn("[Talox Smart] CAPTCHA detected — human intervention or solver required.");
				break;
		}
	}

	private shouldBypassEscalation(reason: AdaptationReason): boolean {
		return this.bypassEscalation && (reason === "blocker_unresolvable_headless" || reason === "blocker_resolved");
	}
}
