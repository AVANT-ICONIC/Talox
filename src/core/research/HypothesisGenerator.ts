/**
 * @file HypothesisGenerator.ts
 * @description Generates strategy variant hypotheses for A/B testing.
 * Produces parameter perturbations of existing strategies, novel combinations,
 * and LLM-driven creative hypotheses.
 */

import type { Planner } from "../loop/Planner.js";
import type { ResearchJournal } from "./ResearchJournal.js";
import type { ExperimentRun, Hypothesis, RunMetrics } from "./types.js";

// ─── Strategies ───────────────────────────────────────────────────────────

interface VariantStrategy {
	name: string;
	generate(base: Record<string, unknown>): Record<string, unknown>;
}

const NUMERIC_PERTURBATION: VariantStrategy = {
	name: "numeric_perturbation",
	generate(base: Record<string, unknown>): Record<string, unknown> {
		const variant: Record<string, unknown> = { ...base };
		for (const [key, value] of Object.entries(base)) {
			if (typeof value === "number") {
				// Perturb by ±10-30%
				const factor = 1 + (Math.random() * 0.6 - 0.3);
				variant[key] = Math.round(value * factor * 1000) / 1000;
			}
		}
		return variant;
	},
};

const BOOLEAN_FLIP: VariantStrategy = {
	name: "boolean_flip",
	generate(base: Record<string, unknown>): Record<string, unknown> {
		const variant: Record<string, unknown> = { ...base };
		for (const [key, value] of Object.entries(base)) {
			if (typeof value === "boolean" && Math.random() > 0.5) {
				variant[key] = !value;
			}
		}
		return variant;
	},
};

const CONSERVATIVE_SHIFT: VariantStrategy = {
	name: "conservative_shift",
	generate(base: Record<string, unknown>): Record<string, unknown> {
		return { ...base, stealthLevel: 0.9, humanDelay: true, retryOnFailure: true, maxRetries: 3 };
	},
};

const AGGRESSIVE_SHIFT: VariantStrategy = {
	name: "aggressive_shift",
	generate(base: Record<string, unknown>): Record<string, unknown> {
		return { ...base, stealthLevel: 0.3, humanDelay: false, retryOnFailure: false, maxRetries: 1 };
	},
};

// ─── HypothesisGenerator ──────────────────────────────────────────────────

export class HypothesisGenerator {
	private readonly planner: Planner | null;
	private readonly journal: ResearchJournal;
	private readonly variantStrategies: readonly VariantStrategy[];
	private idCounter = 0;

	constructor(journal: ResearchJournal, planner?: Planner) {
		this.journal = journal;
		this.planner = planner ?? null;
		this.variantStrategies = [NUMERIC_PERTURBATION, BOOLEAN_FLIP, CONSERVATIVE_SHIFT, AGGRESSIVE_SHIFT];
	}

	/**
	 * Generate a set of hypotheses for a given domain and goal.
	 * Returns one "control" (baseline) + N treatment hypotheses.
	 */
	async generate(
		domain: string,
		goal: string,
		baseParameters: Record<string, unknown>,
		count = 3,
	): Promise<Hypothesis[]> {
		const hypotheses: Hypothesis[] = [];

		// Control hypothesis — current best parameters
		hypotheses.push({
			id: this.nextId(),
			description: `Control: current best strategy for ${domain}`,
			variant: "control",
			changeDescription: "No changes — baseline measurement",
			parameters: { ...baseParameters },
		});

		// Generate treatment variants
		const recentRuns = this.journal.getRecentRuns(domain, 5);
		const usedStrategyNames = new Set<string>();

		for (let i = 0; i < count; i++) {
			// Pick a variant strategy we haven't used yet, or cycle
			const available = this.variantStrategies.filter((s) => !usedStrategyNames.has(s.name));
			const strategy =
				available[i % available.length] ??
				this.variantStrategies[i % this.variantStrategies.length] ??
				this.variantStrategies[0]!;
			usedStrategyNames.add(strategy.name);

			const variantParams = strategy.generate(baseParameters);

			hypotheses.push({
				id: this.nextId(),
				description: `Treatment ${i + 1}: ${strategy.name} for ${domain}`,
				variant: `treatment_${strategy.name}_${i + 1}`,
				changeDescription: `Applied ${strategy.name} to base parameters`,
				parameters: variantParams,
			});
		}

		// Optionally ask the LLM planner for a creative hypothesis
		if (this.planner && recentRuns.length > 0) {
			const llmHypothesis = await this.generateLLMHypothesis(domain, goal, recentRuns);
			if (llmHypothesis) {
				hypotheses.push(llmHypothesis);
			}
		}

		// Record all hypotheses in the journal
		for (const h of hypotheses) {
			this.journal.recordHypothesis(h);
		}

		return hypotheses;
	}

	/**
	 * Ask the LLM planner to suggest a novel strategy based on recent failures.
	 */
	private async generateLLMHypothesis(
		domain: string,
		goal: string,
		recentRuns: ExperimentRun[],
	): Promise<Hypothesis | null> {
		if (!this.planner?.generateSkill) return null;

		try {
			const recentSummary = recentRuns
				.map(
					(r) =>
						`Run: goalAchieved=${r.metrics.goalAchieved}, iterations=${r.metrics.iterationsToGoal}, blockers=${r.metrics.blockerCount}`,
				)
				.join("; ");

			const input = {
				blockerType: "research_hypothesis",
				blockerDescription: `Generate a novel strategy variant for domain ${domain}, goal: ${goal}. Recent runs: ${recentSummary}`,
				evidence: recentRuns.map((r) => `iterations=${r.metrics.iterationsToGoal}`),
				suggestedApproach: "Suggest parameter changes that might improve performance",
				recentHistory: recentSummary,
			};

			const skill = await this.planner.generateSkill(input);
			if (!skill) return null;

			return {
				id: this.nextId(),
				description: `LLM-generated hypothesis: ${skill.description}`,
				variant: "treatment_llm",
				changeDescription: skill.triggerCondition,
				parameters: { llmSuggested: true, skillContent: skill.content },
			};
		} catch {
			return null;
		}
	}

	private nextId(): string {
		return `hyp_${Date.now()}_${++this.idCounter}`;
	}
}
