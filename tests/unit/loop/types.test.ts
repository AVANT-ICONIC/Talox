import { describe, expect, it } from "vitest";
import type {
	AutonomousLoopOptions,
	BlockerClassification,
	BlockerType,
	DynamicSkill,
	LoopIteration,
	LoopResult,
	LoopState,
	LoopStatus,
	LoopStopReason,
	LoopStrategy,
	PlannerConfig,
	PlannerInput,
	PlanStep,
	TaskGoal,
	TaskPlan,
	TokenUsage,
} from "../../../src/core/loop/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const VALID_TASK_GOAL: TaskGoal = {
	description: "Search for TypeScript best practices",
	startUrl: "https://example.com",
	maxIterations: 10,
	maxCostUsd: 1.5,
	maxDurationSeconds: 300,
	strategy: "balanced",
};

const VALID_PLAN_STEP: PlanStep = {
	index: 0,
	action: "Click the search button",
	tool: "click",
	args: { selector: "#search" },
	reasoning: "Need to open the search dialog first",
	retryable: true,
};

const VALID_TOKEN_USAGE: TokenUsage = {
	promptTokens: 500,
	completionTokens: 200,
	totalTokens: 700,
	estimatedCostUsd: 0.035,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("loop/types", () => {
	describe("TaskGoal", () => {
		it("has required description and maxIterations", () => {
			const goal: TaskGoal = {
				description: "Do something",
				maxIterations: 5,
			};
			expect(goal.description).toBe("Do something");
			expect(goal.maxIterations).toBe(5);
		});

		it("accepts all optional fields", () => {
			expect(VALID_TASK_GOAL.startUrl).toBe("https://example.com");
			expect(VALID_TASK_GOAL.maxCostUsd).toBe(1.5);
			expect(VALID_TASK_GOAL.maxDurationSeconds).toBe(300);
			expect(VALID_TASK_GOAL.strategy).toBe("balanced");
		});
	});

	describe("PlanStep", () => {
		it("has required fields", () => {
			expect(VALID_PLAN_STEP.index).toBe(0);
			expect(VALID_PLAN_STEP.action).toBe("Click the search button");
			expect(VALID_PLAN_STEP.tool).toBe("click");
			expect(VALID_PLAN_STEP.args).toEqual({ selector: "#search" });
			expect(VALID_PLAN_STEP.reasoning).toBe("Need to open the search dialog first");
			expect(VALID_PLAN_STEP.retryable).toBe(true);
		});
	});

	describe("TokenUsage", () => {
		it("has all token fields", () => {
			expect(VALID_TOKEN_USAGE.promptTokens).toBe(500);
			expect(VALID_TOKEN_USAGE.completionTokens).toBe(200);
			expect(VALID_TOKEN_USAGE.totalTokens).toBe(700);
			expect(VALID_TOKEN_USAGE.estimatedCostUsd).toBe(0.035);
		});
	});

	describe("LoopState", () => {
		it("has required fields with valid data", () => {
			const state: LoopState = {
				goal: VALID_TASK_GOAL,
				currentIteration: 3,
				iterations: [],
				createdSkills: ["search-skill"],
				totalTokenUsage: VALID_TOKEN_USAGE,
				startedAt: "2026-04-20T00:00:00.000Z",
				status: "running",
			};
			expect(state.status).toBe("running");
			expect(state.currentIteration).toBe(3);
			expect(state.createdSkills).toEqual(["search-skill"]);
			expect(state.totalTokenUsage.totalTokens).toBe(700);
		});
	});

	describe("LoopStrategy", () => {
		it("accepts all valid strategy values", () => {
			const strategies: LoopStrategy[] = ["conservative", "balanced", "aggressive"];
			expect(strategies).toHaveLength(3);
		});
	});

	describe("LoopStatus", () => {
		it("accepts all valid status values", () => {
			const statuses: LoopStatus[] = ["running", "paused", "completed", "failed", "human-takeover", "budget-exhausted"];
			expect(statuses).toHaveLength(6);
		});
	});

	describe("LoopStopReason", () => {
		it("accepts all valid stop reason values", () => {
			const reasons: LoopStopReason[] = [
				"goal-achieved",
				"max-iterations",
				"max-cost",
				"max-duration",
				"unresolvable-blocker",
				"human-takeover",
				"error",
			];
			expect(reasons).toHaveLength(7);
		});
	});

	describe("BlockerType", () => {
		it("accepts all valid blocker type values", () => {
			const types: BlockerType[] = [
				"captcha",
				"cloudflare",
				"login-wall",
				"consent-wall",
				"age-gate",
				"paywall",
				"rate-limit",
				"navigation-failure",
				"element-not-found",
				"unexpected-page",
				"timeout",
				"unknown",
			];
			expect(types).toHaveLength(12);
		});
	});

	describe("BlockerClassification", () => {
		it("has required fields", () => {
			const blocker: BlockerClassification = {
				type: "captcha",
				confidence: 0.9,
				description: "CAPTCHA detected on page",
				evidence: ["hCaptcha iframe found"],
				autoResolvable: false,
				suggestedApproach: "Request human takeover",
			};
			expect(blocker.type).toBe("captcha");
			expect(blocker.confidence).toBe(0.9);
			expect(blocker.evidence).toHaveLength(1);
			expect(blocker.autoResolvable).toBe(false);
		});
	});
});
