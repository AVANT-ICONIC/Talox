// src/core/loop/types.ts

import type { Planner } from "./Planner.js";

// ── Goal & Task Model ──

export interface TaskGoal {
	description: string;
	startUrl?: string;
	maxIterations: number;
	maxCostUsd?: number;
	maxDurationSeconds?: number;
	strategy?: LoopStrategy;
}

export type LoopStrategy = "conservative" | "balanced" | "aggressive";

export interface PlanStep {
	index: number;
	action: string;
	tool: string;
	args: Record<string, unknown>;
	reasoning: string;
	retryable: boolean;
}

export interface TaskPlan {
	assessment: string;
	steps: PlanStep[];
	goalAchieved: boolean;
	blocker?: BlockerClassification;
}

export interface BlockerClassification {
	type: BlockerType;
	confidence: number;
	description: string;
	evidence: string[];
	autoResolvable: boolean;
	suggestedApproach?: string;
}

export type BlockerType =
	| "captcha"
	| "cloudflare"
	| "login-wall"
	| "consent-wall"
	| "age-gate"
	| "paywall"
	| "rate-limit"
	| "navigation-failure"
	| "element-not-found"
	| "unexpected-page"
	| "timeout"
	| "unknown";

export interface LoopIteration {
	iteration: number;
	observation: string;
	plan: TaskPlan;
	result: StepResult;
	timestamp: string;
	tokenUsage?: TokenUsage;
}

export interface StepResult {
	status: "success" | "failed" | "blocked" | "skipped";
	state?: import("../../types/index.js").AgentPageState;
	error?: string;
	challenge?: import("../ChallengeDetector.js").DetectedChallenge;
	durationMs: number;
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	estimatedCostUsd: number;
}

export interface LoopState {
	goal: TaskGoal;
	currentIteration: number;
	iterations: LoopIteration[];
	createdSkills: string[];
	totalTokenUsage: TokenUsage;
	startedAt: string;
	status: LoopStatus;
	stopReason?: LoopStopReason;
}

export type LoopStatus =
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "human-takeover"
	| "budget-exhausted";

export type LoopStopReason =
	| "goal-achieved"
	| "max-iterations"
	| "max-cost"
	| "max-duration"
	| "unresolvable-blocker"
	| "human-takeover"
	| "error";

export interface LoopEventMap {
	loopStarted: { goal: TaskGoal };
	loopIteration: { iteration: LoopIteration };
	blockerDetected: { blocker: BlockerClassification; iteration: number };
	skillCreated: { skillName: string; triggeredBy: string };
	skillValidated: { skillName: string; success: boolean };
	goalAchieved: { totalIterations: number; totalCostUsd: number };
	loopStopped: { reason: LoopStopReason; finalState: LoopState };
	humanEscalation: { reason: string; state: LoopState };
}

// ── Planner Interface ──

export interface PlannerInput {
	state: import("../../types/index.js").AgentPageState;
	goal: TaskGoal;
	recentIterations: LoopIteration[];
	skillsContext: string;
	challengeState?: import("../ChallengeDetector.js").ChallengeState;
	domainHints?: string;
}

export interface PlannerConfig {
	apiBaseUrl?: string;
	apiKey?: string;
	model: string;
	maxTokens?: number;
	systemPrompt?: string;
	contextWindowIterations?: number;
}

// ── Skill Generation ──

export interface SkillGenerationInput {
	blockerType: string;
	blockerDescription: string;
	evidence: string[];
	suggestedApproach: string;
	recentHistory: string;
}

// ── Skill Writer ──

export interface DynamicSkill {
	name: string;
	description: string;
	domain: string;
	version: string;
	content: string;
	triggerCondition: string;
	toolUsage: string[];
}

// ── Public API ──

export interface AutonomousLoopOptions {
	goal: TaskGoal;
	planner: PlannerConfig;
	onHumanEscalation?: (reason: string, state: LoopState) => Promise<string | undefined>;
	onProgress?: (iteration: LoopIteration) => void;
	skillsDir?: string;
	persistState?: boolean;
	/** Override the internally-created planner. Intended for testing. */
	plannerOverride?: Planner;
}

export interface LoopResult {
	status: "completed" | "failed" | "human-takeover";
	goal: TaskGoal;
	totalIterations: number;
	totalDurationMs: number;
	totalCostUsd: number;
	createdSkills: string[];
	finalState?: import("../../types/index.js").AgentPageState;
	stopReason: LoopStopReason;
}
