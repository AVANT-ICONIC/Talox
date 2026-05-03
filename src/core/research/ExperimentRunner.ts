/**
 * @file ExperimentRunner.ts
 * @description A/B test orchestration — runs experiment arms (control + treatments),
 * collects metrics, and compares results to determine winners.
 *
 * Uses the existing AutonomousLoop to run each arm, then computes
 * ExperimentComparison to decide if a treatment should be promoted.
 */

import type { AutonomousLoop } from "../loop/AutonomousLoop.js";
import type { BlockerType, LoopResult, TaskGoal } from "../loop/types.js";
import type { ResearchJournal } from "./ResearchJournal.js";
import type { AutoResearchConfig, ExperimentComparison, ExperimentRun, Hypothesis, RunMetrics } from "./types.js";

// ─── ExperimentRunner ─────────────────────────────────────────────────────

export class ExperimentRunner {
	private readonly journal: ResearchJournal;
	private readonly config: AutoResearchConfig;
	private idCounter = 0;

	constructor(journal: ResearchJournal, config: AutoResearchConfig) {
		this.journal = journal;
		this.config = config;
	}

	/**
	 * Run a full A/B experiment: execute each hypothesis arm and compare.
	 * Returns the comparison result with a winner determination.
	 */
	async runExperiment(
		hypotheses: Hypothesis[],
		goal: TaskGoal,
		domain: string,
		loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>,
	): Promise<ExperimentComparison | null> {
		if (hypotheses.length < 2) return null;

		const experimentId = this.nextExperimentId();
		const runs: ExperimentRun[] = [];

		// Run each hypothesis arm
		for (const hypothesis of hypotheses) {
			if (this.config.excludedDomains.includes(domain)) {
				continue;
			}

			try {
				const loop = await loopFactory(hypothesis.parameters);
				const result = await loop.run();
				const metrics = this.computeMetrics(result);

				const run: ExperimentRun = {
					id: this.nextRunId(),
					experimentId,
					hypothesis,
					goal: goal.description,
					domain,
					result,
					metrics,
					timestamp: new Date().toISOString(),
				};

				runs.push(run);
				this.journal.recordExperimentRun(run);
			} catch {
				// Individual run failure — continue with remaining arms
			}
		}

		if (runs.length < 2) return null;

		// Compare: first run is control, find best treatment
		const control = runs[0]!;
		let bestTreatment: ExperimentRun | null = null;
		let bestComparison: ExperimentComparison | null = null;

		for (let i = 1; i < runs.length; i++) {
			const treatment = runs[i]!;
			const comparison = this.compare(control, treatment);

			if (!bestComparison || comparison.confidence > bestComparison.confidence) {
				bestTreatment = treatment;
				bestComparison = comparison;
			}
		}

		return bestComparison;
	}

	/**
	 * Run a single arm (for incremental experiments).
	 */
	async runSingleArm(
		hypothesis: Hypothesis,
		goal: TaskGoal,
		domain: string,
		loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>,
	): Promise<ExperimentRun | null> {
		if (this.config.excludedDomains.includes(domain)) {
			return null;
		}

		try {
			const experimentId = this.nextExperimentId();
			const loop = await loopFactory(hypothesis.parameters);
			const result = await loop.run();
			const metrics = this.computeMetrics(result);

			const run: ExperimentRun = {
				id: this.nextRunId(),
				experimentId,
				hypothesis,
				goal: goal.description,
				domain,
				result,
				metrics,
				timestamp: new Date().toISOString(),
			};

			this.journal.recordExperimentRun(run);
			return run;
		} catch {
			return null;
		}
	}

	/**
	 * Compare two experiment runs and determine the winner.
	 */
	compare(control: ExperimentRun, treatment: ExperimentRun): ExperimentComparison {
		const deltas = {
			iterationRatio: this.safeRatio(control.metrics.iterationsToGoal, treatment.metrics.iterationsToGoal),
			durationRatio: this.safeRatio(control.metrics.totalDurationMs, treatment.metrics.totalDurationMs),
			costRatio: this.safeRatio(control.metrics.totalCostUsd, treatment.metrics.totalCostUsd),
			blockerRatio: this.safeRatio(control.metrics.blockerCount, treatment.metrics.blockerCount),
		};

		// Weighted score (higher = treatment better)
		const score =
			deltas.iterationRatio * 0.35 +
			deltas.durationRatio * 0.25 +
			deltas.costRatio * 0.15 +
			deltas.blockerRatio * 0.15 +
			(treatment.metrics.goalAchieved ? 0.1 : 0);

		let winner: "control" | "treatment" | "inconclusive";
		if (score > 1 + this.config.promotionThreshold) {
			winner = "treatment";
		} else if (score < 1 - this.config.promotionThreshold) {
			winner = "control";
		} else {
			winner = "inconclusive";
		}

		return {
			control,
			treatment,
			deltas,
			winner,
			confidence: Math.abs(score - 1),
		};
	}

	// ─── Private ───────────────────────────────────────────────────────────

	computeMetrics(result: LoopResult): RunMetrics {
		const blockerTypes: BlockerType[] = [];
		// Extract blocker types from the result's final state if available
		// For now, derive from iteration data
		return {
			iterationsToGoal: result.totalIterations,
			totalDurationMs: result.totalDurationMs,
			totalCostUsd: result.totalCostUsd,
			blockerCount: blockerTypes.length,
			blockerTypes,
			goalAchieved: result.status === "completed",
			skillsCreated: result.createdSkills.length,
			strategySuccessRate: result.status === "completed" ? 1.0 : 0.0,
		};
	}

	private safeRatio(a: number, b: number): number {
		if (b === 0) return a === 0 ? 1 : 2;
		return a / b;
	}

	private nextExperimentId(): string {
		return `exp_${Date.now()}_${++this.idCounter}`;
	}

	private nextRunId(): string {
		return `run_${Date.now()}_${++this.idCounter}`;
	}
}
