/**
 * @file CrossDomainTransfer.ts
 * @description Transfer learning across domains — identifies strategies that
 * succeed on one domain and attempts to apply them to similar domains.
 *
 * Domain similarity is computed from shared strategy patterns, blocker types,
 * and structural similarity (e.g., both are SPA frameworks, both use Cloudflare).
 */

import type { ResearchJournal } from "./ResearchJournal.js";
import type {
	TransferRecord,
	DomainResearchSummary,
	StrategyPromotion,
	ExperimentRun,
} from "./types.js";

// ─── Domain Similarity ────────────────────────────────────────────────────

interface DomainFeatures {
	blockerTypes: Set<string>;
	strategiesUsed: Set<string>;
	successRate: number;
	avgIterations: number;
}

// ─── CrossDomainTransfer ──────────────────────────────────────────────────

export class CrossDomainTransfer {
	private readonly journal: ResearchJournal;
	private readonly minSimilarity = 0.3;
	private readonly minSourceSuccessRate = 0.6;

	constructor(journal: ResearchJournal) {
		this.journal = journal;
	}

	/**
	 * Find candidate strategies from similar domains that could help the target domain.
	 * Returns a ranked list of transfer candidates.
	 */
	findTransferCandidates(targetDomain: string): StrategyPromotion[] {
		const targetFeatures = this.getDomainFeatures(targetDomain);
		if (!targetFeatures) return [];

		const candidates: Array<{ promotion: StrategyPromotion; similarity: number }> = [];

		for (const domain of this.journal.getKnownDomains()) {
			if (domain === targetDomain) continue;

			const summary = this.journal.getDomainSummary(domain);
			if (!summary || summary.successRate < this.minSourceSuccessRate) continue;

			const sourceFeatures = this.getDomainFeatures(domain);
			if (!sourceFeatures) continue;

			const similarity = this.computeSimilarity(targetFeatures, sourceFeatures);
			if (similarity < this.minSimilarity) continue;

			// Get the best strategy from this domain
			const promotions = this.journal
				.getEntries("strategy_promoted")
				.map((e) => e.data as StrategyPromotion)
				.filter((p) => p.domain === domain);

			for (const promotion of promotions) {
				candidates.push({ promotion, similarity });
			}
		}

		// Sort by similarity descending
		candidates.sort((a, b) => b.similarity - a.similarity);
		return candidates.map((c) => c.promotion);
	}

	/**
	 * Record a transfer attempt outcome.
	 */
	recordTransfer(
		sourceDomain: string,
		targetDomain: string,
		strategyName: string,
		improvementRatio: number,
	): TransferRecord {
		const record: TransferRecord = {
			sourceDomain,
			targetDomain,
			strategyName,
			transferSuccess: improvementRatio > 1.0,
			improvementRatio,
			timestamp: new Date().toISOString(),
		};

		this.journal.recordTransfer(record);
		return record;
	}

	/**
	 * Get domains similar to the given domain.
	 */
	getSimilarDomains(domain: string, limit = 5): string[] {
		const targetFeatures = this.getDomainFeatures(domain);
		if (!targetFeatures) return [];

		const similarities: Array<{ domain: string; similarity: number }> = [];

		for (const otherDomain of this.journal.getKnownDomains()) {
			if (otherDomain === domain) continue;
			const otherFeatures = this.getDomainFeatures(otherDomain);
			if (!otherFeatures) continue;

			const similarity = this.computeSimilarity(targetFeatures, otherFeatures);
			if (similarity >= this.minSimilarity) {
				similarities.push({ domain: otherDomain, similarity });
			}
		}

		similarities.sort((a, b) => b.similarity - a.similarity);
		return similarities.slice(0, limit).map((s) => s.domain);
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private getDomainFeatures(domain: string): DomainFeatures | null {
		const summary = this.journal.getDomainSummary(domain);
		if (!summary || summary.totalRuns === 0) return null;

		const runs = this.journal.getRecentRuns(domain, 20);
		const blockerTypes = new Set<string>();
		const strategiesUsed = new Set<string>();

		for (const run of runs) {
			for (const bt of run.metrics.blockerTypes) {
				blockerTypes.add(bt);
			}
			strategiesUsed.add(run.hypothesis.variant);
		}

		return {
			blockerTypes,
			strategiesUsed,
			successRate: summary.successRate,
			avgIterations: summary.avgIterationsToGoal,
		};
	}

	private computeSimilarity(a: DomainFeatures, b: DomainFeatures): number {
		// Jaccard similarity on blocker types
		const blockerIntersection = [...a.blockerTypes].filter((x) => b.blockerTypes.has(x)).length;
		const blockerUnion = new Set([...a.blockerTypes, ...b.blockerTypes]).size;
		const blockerSim = blockerUnion === 0 ? 1 : blockerIntersection / blockerUnion;

		// Jaccard similarity on strategies used
		const strategyIntersection = [...a.strategiesUsed].filter((x) => b.strategiesUsed.has(x)).length;
		const strategyUnion = new Set([...a.strategiesUsed, ...b.strategiesUsed]).size;
		const strategySim = strategyUnion === 0 ? 0 : strategyIntersection / strategyUnion;

		// Success rate proximity (closer = more similar)
		const successDiff = 1 - Math.abs(a.successRate - b.successRate);

		// Weighted combination
		return blockerSim * 0.4 + strategySim * 0.3 + successDiff * 0.3;
	}
}
