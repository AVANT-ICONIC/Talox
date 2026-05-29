/**
 * @file AdaptiveExperimentPriority.ts
 * @description Thompson sampling for adaptive experiment prioritization.
 *
 * Instead of round-robin or random experiment selection, uses multi-armed
 * bandit (Thompson sampling) to focus experiments on the most promising
 * strategies while still exploring alternatives.
 *
 * Each "arm" represents a strategy variant. Thompson sampling balances
 * exploitation (running strategies that have worked) with exploration
 * (trying strategies that haven't been tested enough).
 */

import type { ResearchJournal } from "./ResearchJournal.js";
import type { ExperimentArm, StrategyPromotion } from "./types.js";

// ─── AdaptiveExperimentPriority ───────────────────────────────────────────

export class AdaptiveExperimentPriority {
	private readonly journal: ResearchJournal;
	private readonly arms = new Map<string, ExperimentArm>();
	private readonly rng: () => number;

	constructor(journal: ResearchJournal, options?: { seed?: number }) {
		this.journal = journal;
		// Simple seeded RNG for reproducibility (LCG)
		let seed = options?.seed ?? Date.now();
		this.rng = () => {
			seed = (seed * 1664525 + 1013904223) & 0xffffffff;
			return (seed >>> 0) / 0xffffffff;
		};
	}

	/**
	 * Register a strategy arm for Thompson sampling.
	 */
	registerArm(name: string): void {
		if (this.arms.has(name)) return;
		this.arms.set(name, {
			name,
			alpha: 1, // Beta distribution: alpha = successes + 1
			beta: 1, // Beta distribution: beta = failures + 1
			sampleCount: 0,
			estimatedValue: 0.5,
		});
	}

	/**
	 * Record the outcome of running a strategy.
	 * @param armName - Strategy name
	 * @param success - Whether the run was successful
	 */
	recordOutcome(armName: string, success: boolean): void {
		const arm = this.arms.get(armName);
		if (!arm) return;

		if (success) {
			arm.alpha++;
		} else {
			arm.beta++;
		}
		arm.sampleCount++;
		arm.estimatedValue = arm.alpha / (arm.alpha + arm.beta);
	}

	/**
	 * Select the next strategy to experiment with using Thompson sampling.
	 * Samples from each arm's Beta distribution and returns the arm with
	 * the highest sample.
	 */
	selectNext(): string | null {
		if (this.arms.size === 0) return null;

		let bestName: string | null = null;
		let bestSample = -Infinity;

		for (const [name, arm] of this.arms) {
			const sample = this.sampleBeta(arm.alpha, arm.beta);
			if (sample > bestSample) {
				bestSample = sample;
				bestName = name;
			}
		}

		return bestName;
	}

	/**
	 * Get ranked list of arms by estimated value (descending).
	 */
	getRankedArms(): ExperimentArm[] {
		return [...this.arms.values()].sort((a, b) => b.estimatedValue - a.estimatedValue);
	}

	/**
	 * Get the current best arm (highest estimated value).
	 */
	getBestArm(): ExperimentArm | null {
		const ranked = this.getRankedArms();
		return ranked[0] ?? null;
	}

	/**
	 * Get stats for a specific arm.
	 */
	getArmStats(name: string): ExperimentArm | null {
		return this.arms.get(name) ?? null;
	}

	/**
	 * Get total number of registered arms.
	 */
	get armCount(): number {
		return this.arms.size;
	}

	/**
	 * Initialize arms from journal history.
	 * Looks at past experiment runs and strategy promotions to set
	 * initial alpha/beta values.
	 */
	initializeFromHistory(): void {
		// Get all promoted strategies — they start with higher alpha
		const promotions = this.journal.getEntries("strategy_promoted").map((e) => e.data as StrategyPromotion);

		for (const promo of promotions) {
			this.registerArm(promo.strategyName);
			const arm = this.arms.get(promo.strategyName);
			if (!arm) continue;
			// Promoted strategies get a bonus
			arm.alpha += 3;
			arm.sampleCount += 3;
			arm.estimatedValue = arm.alpha / (arm.alpha + arm.beta);
		}
	}

	/**
	 * Remove an arm from tracking.
	 */
	removeArm(name: string): boolean {
		return this.arms.delete(name);
	}

	// ─── Private ───────────────────────────────────────────────────────────

	/**
	 * Sample from a Beta distribution using Johnk's algorithm.
	 * Good for alpha, beta >= 1.
	 */
	private sampleBeta(alpha: number, beta: number): number {
		if (alpha <= 0 || beta <= 0) return this.rng();

		// For integer or simple values, use the Gamma ratio method
		const x = this.sampleGamma(alpha);
		const y = this.sampleGamma(beta);
		return x / (x + y);
	}

	/**
	 * Sample from Gamma distribution using Marsaglia and Tsang's method.
	 */
	private sampleGamma(shape: number): number {
		if (shape < 1) {
			// Use the relation: if X ~ Gamma(1 + k), then X * U^(1/k) ~ Gamma(k)
			return this.sampleGamma(shape + 1) * this.rng() ** (1 / shape);
		}

		const d = shape - 1 / 3;
		const c = 1 / Math.sqrt(9 * d);

		while (true) {
			let x: number;
			let v: number;

			do {
				x = this.sampleNormal();
				v = 1 + c * x;
			} while (v <= 0);

			v = v * v * v;
			const u = this.rng();

			if (u < 1 - 0.0331 * (x * x) * (x * x)) {
				return d * v;
			}

			if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
				return d * v;
			}
		}
	}

	/**
	 * Sample from standard normal distribution (Box-Muller).
	 */
	private sampleNormal(): number {
		const u1 = this.rng();
		const u2 = this.rng();
		return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}
}
