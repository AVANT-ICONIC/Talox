/**
 * @file AutoResearchLoop.ts
 * @description Main orchestrator for the autonomous research system.
 *
 * Coordinates all research subsystems to form a Karpathy-style self-research
 * loop: the system autonomously tests strategies, measures outcomes, and
 * rewrites itself to become better over time.
 *
 * Flow:
 *  1. Load journal + history
 *  2. Generate hypotheses (HypothesisGenerator)
 *  3. Optionally transfer strategies from similar domains (CrossDomainTransfer)
 *  4. Optionally evolve prompts (PromptEvolver)
 *  5. Run experiments (ExperimentRunner)
 *  6. Evaluate skills (SkillEvaluator)
 *  7. Promote winning strategies
 *  8. Discover composed strategies (StrategyComposer)
 *  9. Run regression tests (RegressionHarness)
 * 10. Generate report (ResearchReporter)
 * 11. Persist journal
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AutonomousLoop } from "../loop/AutonomousLoop.js";
import type { Planner } from "../loop/Planner.js";
import type { LoopResult, TaskGoal } from "../loop/types.js";
import { AdaptiveExperimentPriority } from "./AdaptiveExperimentPriority.js";
import { CrossDomainTransfer } from "./CrossDomainTransfer.js";
import { ExperimentRunner } from "./ExperimentRunner.js";
import { HypothesisGenerator } from "./HypothesisGenerator.js";
import { PromptEvolver } from "./PromptEvolver.js";
import { RegressionHarness } from "./RegressionHarness.js";
import { ResearchJournal } from "./ResearchJournal.js";
import { ResearchReporter } from "./ResearchReporter.js";
import { SkillEvaluator } from "./SkillEvaluator.js";
import { SkillVersioning } from "./SkillVersioning.js";
import { StrategyComposer } from "./StrategyComposer.js";
import type {
	AutoResearchConfig,
	ExperimentComparison,
	ExperimentRun,
	Hypothesis,
	ResearchResult,
	SkillEvaluation,
	StrategyPromotion,
} from "./types.js";

// ─── Default Config ───────────────────────────────────────────────────────

export const DEFAULT_RESEARCH_CONFIG: AutoResearchConfig = {
	runsPerVariant: 3,
	promotionThreshold: 0.15,
	excludedDomains: [],
	persistToDisk: true,
	researchDir: ".talox/research",
	maxConcurrentExperiments: 1,
	enableCrossDomainTransfer: true,
	enablePromptEvolution: true,
	maxSkillVersions: 10,
	regressionTimeoutMs: 60_000,
	adaptivePriority: true,
	compositionConfidenceThreshold: 0.7,
};

// ─── AutoResearchLoop ─────────────────────────────────────────────────────

export class AutoResearchLoop {
	private readonly config: AutoResearchConfig;
	private readonly journal: ResearchJournal;
	private readonly hypothesisGenerator: HypothesisGenerator;
	private readonly skillEvaluator: SkillEvaluator;
	private readonly experimentRunner: ExperimentRunner;
	private readonly crossDomainTransfer: CrossDomainTransfer;
	private readonly promptEvolver: PromptEvolver | null;
	private readonly skillVersioning: SkillVersioning;
	private readonly regressionHarness: RegressionHarness;
	private readonly reporter: ResearchReporter;
	private readonly priority: AdaptiveExperimentPriority;
	private readonly composer: StrategyComposer;

	private readonly loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>;
	private readonly planner: Planner | null;

	private initialized = false;

	constructor(
		loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>,
		options: {
			config?: Partial<AutoResearchConfig>;
			planner?: Planner;
		} = {},
	) {
		this.loopFactory = loopFactory;
		this.planner = options.planner ?? null;
		this.config = { ...DEFAULT_RESEARCH_CONFIG, ...options.config };

		this.journal = new ResearchJournal(
			this.config.persistToDisk ? { persistPath: join(this.config.researchDir, "journal.jsonl") } : {},
		);

		this.hypothesisGenerator = new HypothesisGenerator(this.journal, this.planner ?? undefined);
		this.skillEvaluator = new SkillEvaluator(this.journal);
		this.experimentRunner = new ExperimentRunner(this.journal, this.config);
		this.crossDomainTransfer = new CrossDomainTransfer(this.journal);
		this.promptEvolver = this.config.enablePromptEvolution
			? new PromptEvolver(this.journal, join(this.config.researchDir, "prompts"))
			: null;
		this.skillVersioning = new SkillVersioning(
			join(this.config.researchDir, "skill-versions"),
			this.config.maxSkillVersions,
		);
		this.regressionHarness = new RegressionHarness(this.config);
		this.reporter = new ResearchReporter(this.journal);
		this.priority = new AdaptiveExperimentPriority(this.journal);
		this.composer = new StrategyComposer(this.journal, this.config.compositionConfidenceThreshold);
	}

	/**
	 * Initialize the research loop — load journal, history, regression suite.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await mkdir(this.config.researchDir, { recursive: true });
		await this.journal.load();
		await this.skillVersioning.initialize();
		await this.regressionHarness.load();

		// Initialize Thompson sampling from history
		this.priority.initializeFromHistory();

		this.initialized = true;
	}

	/**
	 * Run a full research cycle for a given goal and domain.
	 * This is the main entry point.
	 */
	async run(goal: TaskGoal, domain: string): Promise<ResearchResult> {
		await this.initialize();

		const experiments: ExperimentRun[] = [];
		const promotions: StrategyPromotion[] = [];

		// 1. Get baseline parameters from domain summary
		const domainSummary = this.journal.getDomainSummary(domain);
		const baseParameters = this.getBaseParameters(domain);

		// 2. Generate hypotheses
		const hypotheses = await this.hypothesisGenerator.generate(
			domain,
			goal.description,
			baseParameters,
			this.config.runsPerVariant,
		);

		// 3. Add cross-domain transfer hypotheses if any
		this.addCrossDomainTransferHypotheses(domain, hypotheses);

		// 4. If prompt evolution is enabled, get a variant prompt
		if (this.promptEvolver) {
			await this.promptEvolver.initialize(this.getSeedPrompt());
		}

		// 5. Run A/B experiment
		const comparison = await this.experimentRunner.runExperiment(hypotheses, goal, domain, this.loopFactory);

		// Collect experiment runs
		const recentRuns = this.journal.getRecentRuns(domain, hypotheses.length + 5);
		experiments.push(...recentRuns);

		// 6 & 7. Process experiment outcomes
		this.processExperimentOutcomes(comparison, experiments, promotions, domain);

		// 8. Discover strategy compositions
		const compositions = this.composer.discoverCandidates();
		for (const comp of compositions) {
			this.composer.recordComposition(comp);
		}

		// 9. Evaluate existing skills for this domain
		const evaluations: SkillEvaluation[] = [];
		await this.evaluateAndRollbackSkills(domain, domainSummary, evaluations);

		// 10. Run regression suite if there were promotions
		if (promotions.length > 0) {
			await this.regressionHarness.runSuite(this.loopFactory);
		}

		// 11. Persist everything
		await this.journal.flush();
		await this.regressionHarness.save();

		return {
			loopResult: experiments.length > 0 ? experiments.at(-1)!.result : this.emptyLoopResult(),
			experiments,
			evaluations,
			promotions,
			journal: this.journal.toSnapshot(),
		};
	}

	private addCrossDomainTransferHypotheses(domain: string, hypotheses: Hypothesis[]): void {
		if (this.config.enableCrossDomainTransfer) {
			const transferCandidates = this.crossDomainTransfer.findTransferCandidates(domain);
			for (const candidate of transferCandidates.slice(0, 2)) {
				// Add transfer candidates as additional hypotheses
				hypotheses.push({
					id: `hyp_transfer_${Date.now()}`,
					description: `Transferred strategy "${candidate.strategyName}" from similar domain`,
					variant: `transfer_${candidate.strategyName}`,
					changeDescription: `Cross-domain transfer from ${candidate.domain}`,
					parameters: candidate.winningParameters,
				});
			}
		}
	}

	private processExperimentOutcomes(
		comparison: ExperimentComparison | null,
		experiments: ExperimentRun[],
		promotions: StrategyPromotion[],
		domain: string,
	): void {
		// 6. Evaluate and promote winners
		if (comparison?.winner === "treatment") {
			const promotion: StrategyPromotion = {
				strategyName: comparison.treatment.hypothesis.variant,
				domain,
				winningParameters: comparison.treatment.hypothesis.parameters,
				evidence: [comparison.control.id, comparison.treatment.id],
				promotedAt: new Date().toISOString(),
			};

			promotions.push(promotion);
			this.journal.recordStrategyPromotion(promotion);

			// Record outcome for adaptive priority
			this.priority.recordOutcome(comparison.treatment.hypothesis.variant, true);
			this.priority.recordOutcome(comparison.control.hypothesis.variant, false);
		}

		// 7. Record all outcomes for Thompson sampling
		for (const run of experiments) {
			this.priority.registerArm(run.hypothesis.variant);
			this.priority.recordOutcome(run.hypothesis.variant, run.metrics.goalAchieved);
		}
	}

	private async evaluateAndRollbackSkills(
		domain: string,
		domainSummary: any,
		evaluations: SkillEvaluation[],
	): Promise<void> {
		if (domainSummary && domainSummary.knownSkills.length > 0) {
			const allDomainRuns = this.journal.getRecentRuns(domain, 50);
			for (const skillName of domainSummary.knownSkills) {
				const shouldKeep = this.skillEvaluator.shouldKeepSkill(skillName);
				if (!shouldKeep) {
					await this.skillVersioning.rollbackToBest(skillName);
				}
				// Produce a before/after evaluation for each known skill
				const skillRunIndex = allDomainRuns.findIndex((r) => r.result.createdSkills?.includes(skillName));
				if (skillRunIndex >= 0) {
					const beforeRuns = allDomainRuns.slice(0, skillRunIndex);
					const afterRuns = allDomainRuns.slice(skillRunIndex);
					if (beforeRuns.length > 0 && afterRuns.length > 0) {
						const evaluation = this.skillEvaluator.evaluate(skillName, domain, beforeRuns, afterRuns);
						evaluations.push(evaluation);
					}
				}
			}
		}
	}

	/**
	 * Generate a research report for a time period.
	 */
	generateReport(period: { from: string; to: string }) {
		return this.reporter.generateReport(period);
	}

	/**
	 * Get the research journal.
	 */
	getJournal(): ResearchJournal {
		return this.journal;
	}

	/**
	 * Get the adaptive priority tracker.
	 */
	getPriority(): AdaptiveExperimentPriority {
		return this.priority;
	}

	/**
	 * Get the strategy composer.
	 */
	getComposer(): StrategyComposer {
		return this.composer;
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private getBaseParameters(domain: string): Record<string, unknown> {
		return {
			stealthLevel: 0.5,
			humanDelay: true,
			retryOnFailure: true,
			maxRetries: 2,
			domain,
		};
	}

	private getSeedPrompt(): string {
		return [
			"You are an autonomous web browsing agent. Complete the task efficiently.",
			"Prioritize speed — minimize unnecessary page loads and waits.",
			"Be stealthy — mimic human browsing patterns with natural delays.",
			"On errors, retry with exponential backoff. Never give up early.",
			"Analyze the page structure before interacting. Read before clicking.",
		].join("\n");
	}

	private emptyLoopResult(): LoopResult {
		return {
			status: "completed",
			goal: { description: "research-baseline", maxIterations: 0 },
			totalIterations: 0,
			totalDurationMs: 0,
			totalCostUsd: 0,
			createdSkills: [],
			stopReason: "goal-achieved",
		};
	}
}
