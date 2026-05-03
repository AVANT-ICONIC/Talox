/**
 * @file research/index.ts
 * @description Barrel export for the Talox v7 research subsystem.
 *
 * The research system implements a Karpathy-style self-research loop:
 * autonomously test, measure, and rewrite browser interaction strategies.
 */

export { AdaptiveExperimentPriority } from "./AdaptiveExperimentPriority.js";
export { AutoResearchLoop, DEFAULT_RESEARCH_CONFIG } from "./AutoResearchLoop.js";
// ─── Extended Subsystems ──────────────────────────────────────────────────
export { CrossDomainTransfer } from "./CrossDomainTransfer.js";
export { ExperimentRunner } from "./ExperimentRunner.js";
export { HypothesisGenerator } from "./HypothesisGenerator.js";
export { PromptEvolver } from "./PromptEvolver.js";
export { RegressionHarness } from "./RegressionHarness.js";
// ─── Core Subsystems ──────────────────────────────────────────────────────
export { ResearchJournal } from "./ResearchJournal.js";
export { ResearchReporter } from "./ResearchReporter.js";
export { SkillEvaluator } from "./SkillEvaluator.js";
export { SkillVersioning } from "./SkillVersioning.js";
export { StrategyComposer } from "./StrategyComposer.js";
// ─── Types ────────────────────────────────────────────────────────────────
export type {
	AutoResearchConfig,
	ComposedStrategy,
	DomainResearchSummary,
	ExperimentArm,
	ExperimentComparison,
	ExperimentId,
	ExperimentRun,
	Hypothesis,
	JournalEntry,
	PromptVariant,
	RegressionResult,
	RegressionTestCase,
	ResearchEventMap,
	ResearchFinding,
	ResearchJournalSnapshot,
	ResearchReport,
	ResearchResult,
	RunMetrics,
	SkillEvaluation,
	SkillVersion,
	StrategyPromotion,
	TransferRecord,
} from "./types.js";
