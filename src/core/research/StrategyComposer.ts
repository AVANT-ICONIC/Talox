/**
 * @file StrategyComposer.ts
 * @description Discovers and evaluates composed strategies — combinations of
 * existing strategies that outperform their individual components.
 *
 * Supports sequential composition (A then B), parallel composition (A + B),
 * and conditional composition (A if X, else B). Uses the journal to identify
 * candidate pairs and the ExperimentRunner to validate them.
 */

import type { ResearchJournal } from "./ResearchJournal.js";
import type {
	ComposedStrategy,
	StrategyPromotion,
	ExperimentRun,
	RunMetrics,
} from "./types.js";

// ─── StrategyComposer ─────────────────────────────────────────────────────

export class StrategyComposer {
	private readonly journal: ResearchJournal;
	private readonly confidenceThreshold: number;
	private composedStrategies: ComposedStrategy[] = [];

	constructor(journal: ResearchJournal, confidenceThreshold = 0.7) {
		this.journal = journal;
		this.confidenceThreshold = confidenceThreshold;
	}

	/**
	 * Discover candidate strategy compositions from the journal.
	 * Looks for strategies that succeeded on overlapping domains.
	 */
	discoverCandidates(): ComposedStrategy[] {
		const promotions = this.journal
			.getEntries("strategy_promoted")
			.map((e) => e.data as StrategyPromotion);

		const candidates: ComposedStrategy[] = [];

		// Group strategies by domain
		const byDomain = new Map<string, StrategyPromotion[]>();
		for (const promo of promotions) {
			const list = byDomain.get(promo.domain) ?? [];
			list.push(promo);
			byDomain.set(promo.domain, list);
		}

		// For domains with 2+ promoted strategies, create compositions
		for (const [domain, strategies] of byDomain) {
			if (strategies.length < 2) continue;

			// Sequential: A then B
			for (let i = 0; i < strategies.length - 1; i++) {
				for (let j = i + 1; j < strategies.length; j++) {
					candidates.push(this.createSequential(strategies[i]!, strategies[j]!, domain));
					candidates.push(this.createSequential(strategies[j]!, strategies[i]!, domain));
				}
			}

			// Parallel: A + B
			for (let i = 0; i < strategies.length - 1; i++) {
				for (let j = i + 1; j < strategies.length; j++) {
					candidates.push(this.createParallel(strategies[i]!, strategies[j]!, domain));
				}
			}

			// Conditional: A if success_rate > threshold, else B
			for (let i = 0; i < strategies.length - 1; i++) {
				for (let j = i + 1; j < strategies.length; j++) {
					candidates.push(this.createConditional(strategies[i]!, strategies[j]!, domain));
				}
			}
		}

		// Also look for cross-domain transfer candidates
		const domains = [...byDomain.keys()];
		for (let i = 0; i < domains.length - 1; i++) {
			for (let j = i + 1; j < domains.length; j++) {
				const domainA = byDomain.get(domains[i]!)!;
				const domainB = byDomain.get(domains[j]!)!;
				// Cross-domain sequential
				if (domainA.length > 0 && domainB.length > 0) {
					candidates.push(
						this.createCrossDomain(domainA[0]!, domainB[0]!, domains[i]!, domains[j]!),
					);
				}
			}
		}

		return candidates;
	}

	/**
	 * Record a composed strategy.
	 */
	recordComposition(composition: ComposedStrategy): void {
		this.composedStrategies.push(composition);
		this.journal.recordComposition(composition);
	}

	/**
	 * Get all recorded composed strategies.
	 */
	getComposedStrategies(): ComposedStrategy[] {
		return [...this.composedStrategies];
	}

	/**
	 * Get the best composed strategy for a domain based on fitness scores.
	 */
	getBestForDomain(domain: string): ComposedStrategy | null {
		const relevant = this.composedStrategies.filter(
			(c) => c.fitnessScore > this.confidenceThreshold,
		);
		if (relevant.length === 0) return null;
		relevant.sort((a, b) => b.fitnessScore - a.fitnessScore);
		return relevant[0]!;
	}

	// ─── Factory Methods ───────────────────────────────────────────────────

	private createSequential(
		a: StrategyPromotion,
		b: StrategyPromotion,
		domain: string,
	): ComposedStrategy {
		return {
			id: `comp_seq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${a.strategyName} → ${b.strategyName}`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "sequential",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	private createParallel(
		a: StrategyPromotion,
		b: StrategyPromotion,
		domain: string,
	): ComposedStrategy {
		return {
			id: `comp_par_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${a.strategyName} + ${b.strategyName}`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "parallel",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	private createConditional(
		a: StrategyPromotion,
		b: StrategyPromotion,
		domain: string,
	): ComposedStrategy {
		return {
			id: `comp_cond_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${a.strategyName} | fallback → ${b.strategyName}`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "conditional",
			condition: `${a.strategyName} succeeds within 5 iterations, else ${b.strategyName}`,
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	private createCrossDomain(
		a: StrategyPromotion,
		b: StrategyPromotion,
		domainA: string,
		domainB: string,
	): ComposedStrategy {
		return {
			id: `comp_xd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `XDomain: ${a.strategyName}(${domainA}) + ${b.strategyName}(${domainB})`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "parallel",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}
}
