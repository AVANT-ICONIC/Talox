/**
 * @file research/index.ts
 * @description Barrel export for the Talox v7 research subsystem.
 *
 * The research system implements a Karpathy-style self-research loop:
 * autonomously test, measure, and rewrite browser interaction strategies.
 */

// ─── Types ────────────────────────────────────────────────────────────────
export type {
	ExperimentId,
	Hypothesis,
	ExperimentRun,
	RunMetrics,
	ExperimentComparison,
	JournalEntry,
	SkillEvaluation,
	StrategyPromotion,
	AutoResearchConfig,
	ResearchResult,
	ResearchJournalSnapshot,
	DomainResearchSummary,
	TransferRecord,
	PromptVariant,
	SkillVersion,
	RegressionTestCase,
	RegressionResult,
	ResearchReport,
	ResearchFinding,
	ExperimentArm,
	ComposedStrategy,
	ResearchEventMap,
} from "./types.js";

// ─── Core Subsystems ──────────────────────────────────────────────────────
export { ResearchJournal } from "./ResearchJournal.js";
export { HypothesisGenerator } from "./HypothesisGenerator.js";
export { SkillEvaluator } from "./SkillEvaluator.js";
export { ExperimentRunner } from "./ExperimentRunner.js";
export { AutoResearchLoop, DEFAULT_RESEARCH_CONFIG } from "./AutoResearchLoop.js";

// ─── Extended Subsystems ──────────────────────────────────────────────────
export { CrossDomainTransfer } from "./CrossDomainTransfer.js";
export { PromptEvolver } from "./PromptEvolver.js";
export { SkillVersioning } from "./SkillVersioning.js";
export { RegressionHarness } from "./RegressionHarness.js";
export { ResearchReporter } from "./ResearchReporter.js";
export { AdaptiveExperimentPriority } from "./AdaptiveExperimentPriority.js";
export { StrategyComposer } from "./StrategyComposer.js";
