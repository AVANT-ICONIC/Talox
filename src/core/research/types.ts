// src/core/research/types.ts

import type { BlockerType, LoopResult } from "../loop/types.js";

// ── Experiment Model ──

export interface ExperimentId {
	readonly id: string;
	readonly createdAt: string;
}

/** What is being tested */
export interface Hypothesis {
	id: string;
	description: string;
	/** The variant label — "control" or a treatment name */
	variant: string;
	/** What changed vs control */
	changeDescription: string;
	/** Strategy parameters being varied */
	parameters: Record<string, unknown>;
}

/** A single measured run within an experiment */
export interface ExperimentRun {
	id: string;
	experimentId: string;
	hypothesis: Hypothesis;
	goal: string;
	domain: string;
	/** Full LoopResult from the underlying AutonomousLoop */
	result: LoopResult;
	/** Derived metrics — computed from LoopResult */
	metrics: RunMetrics;
	timestamp: string;
}

export interface RunMetrics {
	/** Iterations to completion (lower = better) */
	iterationsToGoal: number;
	/** Wall time in ms */
	totalDurationMs: number;
	/** USD cost */
	totalCostUsd: number;
	/** Number of blocker encounters */
	blockerCount: number;
	/** Blocker types encountered */
	blockerTypes: BlockerType[];
	/** Was the goal achieved */
	goalAchieved: boolean;
	/** Did any skill get created during this run */
	skillsCreated: number;
	/** Strategy success rate from DomainMemory for this domain */
	strategySuccessRate: number;
}

/** Comparison between two experiment arms */
export interface ExperimentComparison {
	control: ExperimentRun;
	treatment: ExperimentRun;
	/** Improvement ratios (>1 = treatment better) */
	deltas: {
		iterationRatio: number;
		durationRatio: number;
		costRatio: number;
		blockerRatio: number;
	};
	winner: "control" | "treatment" | "inconclusive";
	confidence: number;
}

// ── Journal Types ──

export interface JournalEntry {
	id: string;
	type:
		| "experiment_run"
		| "skill_created"
		| "skill_evaluated"
		| "hypothesis_generated"
		| "strategy_promoted"
		| "strategy_composed"
		| "cross_domain_transfer";
	timestamp: string;
	data: ExperimentRun | SkillEvaluation | StrategyPromotion | Hypothesis | ComposedStrategy | TransferRecord;
}

export interface SkillEvaluation {
	skillName: string;
	domain: string;
	beforeMetrics: RunMetrics;
	afterMetrics: RunMetrics;
	improvement: number;
	verdict: "helped" | "neutral" | "hurt";
	timestamp: string;
}

export interface StrategyPromotion {
	strategyName: string;
	domain: string;
	/** The parameters that won */
	winningParameters: Record<string, unknown>;
	/** Evidence — experiment IDs that support this */
	evidence: string[];
	promotedAt: string;
}

// ── AutoResearchLoop Config ──

export interface AutoResearchConfig {
	/** How many experiment runs before comparing variants */
	runsPerVariant: number;
	/** Minimum improvement ratio to promote a treatment */
	promotionThreshold: number;
	/** Domains to exclude from experiments (too risky/slow) */
	excludedDomains: string[];
	/** Whether to persist the journal to disk */
	persistToDisk: boolean;
	/** Directory for journal + promoted strategies */
	researchDir: string;
	/** Max concurrent experiment runs (for parallel mode) */
	maxConcurrentExperiments: number;
	/** Enable cross-domain transfer learning */
	enableCrossDomainTransfer: boolean;
	/** Enable prompt self-evolution */
	enablePromptEvolution: boolean;
	/** Max skill versions to retain before pruning */
	maxSkillVersions: number;
	/** Regression test timeout per check (ms) */
	regressionTimeoutMs: number;
	/** Enable Thompson sampling for experiment priority */
	adaptivePriority: boolean;
	/** Confidence threshold for strategy composition */
	compositionConfidenceThreshold: number;
}

// ── AutoResearchLoop Result ──

export interface ResearchResult {
	/** The underlying loop result from the final run */
	loopResult: LoopResult;
	/** Experiments conducted during this session */
	experiments: ExperimentRun[];
	/** Skills evaluated during this session */
	evaluations: SkillEvaluation[];
	/** Whether any strategy was promoted */
	promotions: StrategyPromotion[];
	/** Journal snapshot at end of session */
	journal: ResearchJournalSnapshot;
}

// ── Research Journal Snapshot ──

export interface ResearchJournalSnapshot {
	version: 1;
	exportedAt: string;
	entries: JournalEntry[];
	domains: Record<string, DomainResearchSummary>;
}

export interface DomainResearchSummary {
	domain: string;
	totalRuns: number;
	successRate: number;
	bestStrategy: string | null;
	knownSkills: string[];
	avgIterationsToGoal: number;
}

// ── Cross-Domain Transfer ──

export interface TransferRecord {
	sourceDomain: string;
	targetDomain: string;
	strategyName: string;
	transferSuccess: boolean;
	improvementRatio: number;
	timestamp: string;
}

// ── Prompt Evolution ──

export interface PromptVariant {
	id: string;
	systemPrompt: string;
	parentId: string | null;
	generation: number;
	fitnessScore: number;
	createdAt: string;
}

// ── Skill Versioning ──

export interface SkillVersion {
	skillName: string;
	version: string;
	content: string;
	createdAt: string;
	metrics: RunMetrics | null;
	isCurrent: boolean;
}

// ── Regression Harness ──

export interface RegressionTestCase {
	id: string;
	name: string;
	domain: string;
	goal: string;
	expectedMaxIterations: number;
	expectedMaxDurationMs: number;
	lastRunMetrics: RunMetrics | null;
	lastRunTimestamp: string | null;
	status: "passing" | "failing" | "unknown";
}

export interface RegressionResult {
	testCaseId: string;
	passed: boolean;
	metrics: RunMetrics;
	regressions: string[];
	timestamp: string;
}

// ── Research Report ──

export interface ResearchReport {
	id: string;
	title: string;
	summary: string;
	period: { from: string; to: string };
	experimentsConducted: number;
	strategiesPromoted: number;
	skillsEvaluated: number;
	topFindings: ResearchFinding[];
	domainSummaries: Record<string, DomainResearchSummary>;
	generatedAt: string;
}

export interface ResearchFinding {
	description: string;
	confidence: number;
	evidence: string[];
	impact: "high" | "medium" | "low";
}

// ── Adaptive Priority ──

export interface ExperimentArm {
	name: string;
	alpha: number; // Thompson sampling: successes + 1
	beta: number; // Thompson sampling: failures + 1
	sampleCount: number;
	estimatedValue: number;
}

// ── Strategy Composition ──

export interface ComposedStrategy {
	id: string;
	name: string;
	componentStrategies: string[];
	applicationOrder: "sequential" | "parallel" | "conditional";
	condition?: string;
	fitnessScore: number;
	createdAt: string;
}

// ── Events ──

export interface ResearchEventMap {
	experimentStarted: { experimentId: string; hypothesis: Hypothesis };
	experimentCompleted: { experimentId: string; run: ExperimentRun };
	strategyPromoted: { promotion: StrategyPromotion };
	skillEvaluated: { evaluation: SkillEvaluation };
	regressionDetected: { result: RegressionResult };
	promptEvolved: { variant: PromptVariant };
	transferAttempted: { record: TransferRecord };
	strategyComposed: { composition: ComposedStrategy };
}
