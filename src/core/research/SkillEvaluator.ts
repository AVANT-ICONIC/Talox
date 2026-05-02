/**
 * @file SkillEvaluator.ts
 * @description Before/after skill scoring — measures whether a skill
 * actually improves performance on a domain.
 *
 * Compares metrics from runs before a skill was introduced vs after.
 * Uses statistical comparison to determine if improvement is significant.
 */

import type { ResearchJournal } from "./ResearchJournal.js";
import type {
	RunMetrics,
	SkillEvaluation,
	ExperimentRun,
} from "./types.js";

// ─── SkillEvaluator ───────────────────────────────────────────────────────

export class SkillEvaluator {
	private readonly journal: ResearchJournal;
	private readonly improvementThreshold: number;

	constructor(journal: ResearchJournal, options: { improvementThreshold?: number } = {}) {
		this.journal = journal;
		this.improvementThreshold = options.improvementThreshold ?? 0.1; // 10% minimum
	}

	/**
	 * Evaluate a skill by comparing runs before and after its introduction.
	 * Returns a SkillEvaluation with verdict.
	 */
	evaluate(
		skillName: string,
		domain: string,
		beforeRuns: ExperimentRun[],
		afterRuns: ExperimentRun[],
	): SkillEvaluation {
		const beforeMetrics = this.aggregateMetrics(beforeRuns.map((r) => r.metrics));
		const afterMetrics = this.aggregateMetrics(afterRuns.map((r) => r.metrics));

		// Compute improvement: positive = after is better
		// We measure: fewer iterations, shorter duration, lower cost, fewer blockers
		const iterationImprovement = this.safeRatio(beforeMetrics.iterationsToGoal, afterMetrics.iterationsToGoal) - 1;
		const durationImprovement = this.safeRatio(beforeMetrics.totalDurationMs, afterMetrics.totalDurationMs) - 1;
		const costImprovement = this.safeRatio(beforeMetrics.totalCostUsd, afterMetrics.totalCostUsd) - 1;
		const successImprovement = afterMetrics.goalAchieved ? 0.5 : 0;

		// Weighted improvement score (iterations matter most)
		const improvement =
			iterationImprovement * 0.35 +
			durationImprovement * 0.25 +
			costImprovement * 0.15 +
			successImprovement * 0.25;

		const verdict = this.classifyVerdict(improvement);

		const evaluation: SkillEvaluation = {
			skillName,
			domain,
			beforeMetrics,
			afterMetrics,
			improvement,
			verdict,
			timestamp: new Date().toISOString(),
		};

		this.journal.recordSkillEvaluation(evaluation);
		return evaluation;
	}

	/**
	 * Quick check: should a skill be kept or pruned?
	 * Based on accumulated evaluations in the journal.
	 */
	shouldKeepSkill(skillName: string): boolean {
		const evaluations = this.journal
			.getEntries("skill_evaluated")
			.map((e) => e.data as SkillEvaluation)
			.filter((e) => e.skillName === skillName);

		if (evaluations.length === 0) return true; // No data → keep

		const avgImprovement = evaluations.reduce((sum, e) => sum + e.improvement, 0) / evaluations.length;
		const hurtCount = evaluations.filter((e) => e.verdict === "hurt").length;

		// Prune if consistently hurting AND below threshold
		if (hurtCount >= 2 && avgImprovement < -this.improvementThreshold) {
			return false;
		}

		return true;
	}

	/**
	 * Get the best-performing skill for a domain based on evaluations.
	 */
	getBestSkillForDomain(domain: string): string | null {
		const evaluations = this.journal
			.getEntries("skill_evaluated")
			.map((e) => e.data as SkillEvaluation)
			.filter((e) => e.domain === domain && e.verdict === "helped");

		if (evaluations.length === 0) return null;

		// Return the skill with highest improvement
		evaluations.sort((a, b) => b.improvement - a.improvement);
		return evaluations[0]!.skillName;
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private aggregateMetrics(metrics: RunMetrics[]): RunMetrics {
		if (metrics.length === 0) {
			return {
				iterationsToGoal: 0,
				totalDurationMs: 0,
				totalCostUsd: 0,
				blockerCount: 0,
				blockerTypes: [],
				goalAchieved: false,
				skillsCreated: 0,
				strategySuccessRate: 0,
			};
		}

		const n = metrics.length;
		return {
			iterationsToGoal: Math.round(metrics.reduce((s, m) => s + m.iterationsToGoal, 0) / n),
			totalDurationMs: Math.round(metrics.reduce((s, m) => s + m.totalDurationMs, 0) / n),
			totalCostUsd: metrics.reduce((s, m) => s + m.totalCostUsd, 0) / n,
			blockerCount: Math.round(metrics.reduce((s, m) => s + m.blockerCount, 0) / n),
			blockerTypes: [...new Set(metrics.flatMap((m) => m.blockerTypes))],
			goalAchieved: metrics.filter((m) => m.goalAchieved).length > n / 2,
			skillsCreated: Math.round(metrics.reduce((s, m) => s + m.skillsCreated, 0) / n),
			strategySuccessRate: metrics.reduce((s, m) => s + m.strategySuccessRate, 0) / n,
		};
	}

	private safeRatio(numerator: number, denominator: number): number {
		if (denominator === 0) return numerator === 0 ? 1 : 2;
		return numerator / denominator;
	}

	private classifyVerdict(improvement: number): "helped" | "neutral" | "hurt" {
		if (improvement > this.improvementThreshold) return "helped";
		if (improvement < -this.improvementThreshold) return "hurt";
		return "neutral";
	}
}
