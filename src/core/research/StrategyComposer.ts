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
import type { ComposedStrategy, ExperimentRun, RunMetrics, StrategyPromotion } from "./types.js";

type StrategyPromotedEntry = StrategyPromotion;

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
		const promotions = this.journal.getEntries("strategy_promoted").map((e) => e.data as StrategyPromotion);

		// Group strategies by domain
		const byDomain = new Map<string, StrategyPromotedEntry[]>();
		for (const promo of promotions) {
			const list = byDomain.get(promo.domain) ?? [];
			list.push(promo);
			byDomain.set(promo.domain, list);
		}

		const candidates: ComposedStrategy[] = [];

		// For domains with 2+ promoted strategies, create compositions
		for (const [domain, strategies] of byDomain) {
			candidates.push(...this.discoverIntraDomainPairings(domain, strategies));
		}

		// Also look for cross-domain transfer candidates
		candidates.push(...this.discoverCrossDomainPairings(byDomain));

		return candidates;
	}

	private discoverIntraDomainPairings(domain: string, list: StrategyPromotedEntry[]): ComposedStrategy[] {
		const pairings: ComposedStrategy[] = [];
		if (list.length < 2) return pairings;

		// Sequential: A then B
		for (let i = 0; i < list.length - 1; i++) {
			for (let j = i + 1; j < list.length; j++) {
				pairings.push(this.createSequential(list[i]!, list[j]!, domain));
				pairings.push(this.createSequential(list[j]!, list[i]!, domain));
			}
		}

		// Parallel: A + B
		for (let i = 0; i < list.length - 1; i++) {
			for (let j = i + 1; j < list.length; j++) {
				pairings.push(this.createParallel(list[i]!, list[j]!, domain));
			}
		}

		// Conditional: A if success_rate > threshold, else B
		for (let i = 0; i < list.length - 1; i++) {
			for (let j = i + 1; j < list.length; j++) {
				pairings.push(this.createConditional(list[i]!, list[j]!, domain));
			}
		}

		return pairings;
	}

	private discoverCrossDomainPairings(byDomain: Map<string, StrategyPromotedEntry[]>): ComposedStrategy[] {
		const pairings: ComposedStrategy[] = [];
		const domains = [...byDomain.keys()];
		for (let i = 0; i < domains.length - 1; i++) {
			for (let j = i + 1; j < domains.length; j++) {
				const dA = domains[i];
				if (!dA) continue;
				const domainA = byDomain.get(dA);
				if (!domainA) continue;
				const dB = domains[j];
				if (!dB) continue;
				const domainB = byDomain.get(dB);
				if (!domainB) continue;
				// Cross-domain sequential
				if (domainA.length > 0 && domainB.length > 0) {
					pairings.push(this.createCrossDomain(domainA[0]!, domainB[0]!, domains[i]!, domains[j]!));
				}
			}
		}
		return pairings;
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
		const relevant = this.composedStrategies.filter((c) => c.fitnessScore > this.confidenceThreshold);
		if (relevant.length === 0) return null;
		relevant.sort((a, b) => b.fitnessScore - a.fitnessScore);
		return relevant[0] ?? null;
	}

	// ─── Factory Methods ───────────────────────────────────────────────────

	private createSequential(a: StrategyPromotion, b: StrategyPromotion, domain: string): ComposedStrategy {
		return {
			id: `comp_seq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${a.strategyName} → ${b.strategyName}`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "sequential",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	private createParallel(a: StrategyPromotion, b: StrategyPromotion, domain: string): ComposedStrategy {
		return {
			id: `comp_par_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${a.strategyName} + ${b.strategyName}`,
			componentStrategies: [a.strategyName, b.strategyName],
			applicationOrder: "parallel",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	private createConditional(a: StrategyPromotion, b: StrategyPromotion, domain: string): ComposedStrategy {
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
