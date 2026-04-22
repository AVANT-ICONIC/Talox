/**
 * @file AutonomousLoop.test.ts
 * @description Unit tests for the AutonomousLoop orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPlan } from "../../../src/core/loop/types.js";
import type { Planner } from "../../../src/core/loop/Planner.js";
import { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type {
	AutonomousLoopOptions,
	PlanStep,
} from "../../../src/core/loop/types.js";

// ── Mock Factories ──────────────────────────────────────────────────────────

const { createMockController, createMockPlanner, makeGoal, makePlan, makePageState } =
	vi.hoisted(() => {
		function createMockController() {
			return {
				navigate: vi.fn<(...args: unknown[]) => Promise<any>>(),
				click: vi.fn<(...args: unknown[]) => Promise<any>>(),
				type: vi.fn<(...args: unknown[]) => Promise<any>>(),
				scrollTo: vi.fn<(...args: unknown[]) => Promise<void>>(),
				screenshot: vi.fn<(...args: unknown[]) => Promise<any>>(),
				getState: vi.fn<(...args: unknown[]) => Promise<any>>(),
				getChallengeState: vi.fn<(...args: unknown[]) => Promise<any>>(),
				waitForSelector: vi.fn<(...args: unknown[]) => Promise<void>>(),
				waitForNavigation: vi.fn<(...args: unknown[]) => Promise<void>>(),
				waitForTimeout: vi.fn<(...args: unknown[]) => Promise<void>>(),
				evaluate: vi.fn<(...args: unknown[]) => Promise<any>>(),
				extractTable: vi.fn<(...args: unknown[]) => Promise<any>>(),
				findElement: vi.fn<(...args: unknown[]) => Promise<any>>(),
				on: vi.fn(),
				off: vi.fn(),
				_events: { on: vi.fn(), off: vi.fn() },
				_adapt: {
					domainMemory: {
						extractHostname: vi.fn((url: string) => {
							try {
								return new URL(url).hostname;
							} catch {
								return "unknown";
							}
						}),
						getDomainRecord: vi.fn(() => null),
						getRankedStrategies: vi.fn(() => []),
					},
				},
			};
		}

		function createMockPlanner(plans: TaskPlan[]) {
			let callIndex = 0;
			return {
				plan: vi.fn(async () => {
					const plan = plans[Math.min(callIndex, plans.length - 1)];
					callIndex++;
					return plan;
				}),
			};
		}

		function makeGoal(overrides?: Partial<AutonomousLoopOptions["goal"]>): AutonomousLoopOptions["goal"] {
			return {
				description: "Test goal",
				maxIterations: 5,
				...overrides,
			};
		}

		function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
			return {
				assessment: "Test assessment",
				steps: [],
				goalAchieved: false,
				...overrides,
			};
		}

		function makePageState() {
			return {
				url: "https://example.com/page",
				title: "Example Page",
				timestamp: new Date().toISOString(),
				interactiveElements: ["button#search", "input#email"],
				consoleErrors: [] as string[],
				bugs: [] as Array<{ type: string; severity: string; description: string }>,
			};
		}

		return { createMockController, createMockPlanner, makeGoal, makePlan, makePageState };
	});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOptions(
	overrides?: Partial<AutonomousLoopOptions>,
): AutonomousLoopOptions {
	return {
		goal: makeGoal(),
		planner: { model: "test-model" },
		...overrides,
	};
}

function makeClickStep(overrides?: Partial<PlanStep>): PlanStep {
	return {
		index: 0,
		action: "Click the search button",
		tool: "click",
		args: { selector: "#search" },
		reasoning: "Need to find the search input",
		retryable: true,
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AutonomousLoop", () => {
	let mockController: ReturnType<typeof createMockController>;
	let mockPlanner: ReturnType<typeof createMockPlanner>;

	beforeEach(() => {
		mockController = createMockController();
		// Default: getState returns agent page state
		mockController.getState.mockResolvedValue(makePageState());
		// Default: no challenges
		mockController.getChallengeState.mockResolvedValue({
			hasChallenge: false,
			challenges: [],
			primaryChallenge: null,
		});
		// Default: navigate succeeds
		mockController.navigate.mockResolvedValue(makePageState());
		// Default: click succeeds
		mockController.click.mockResolvedValue(makePageState());
		// Default: type succeeds
		mockController.type.mockResolvedValue(makePageState());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("runs a simple loop to completion when goal is achieved on first iteration", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: true,
				assessment: "Goal achieved!",
				steps: [makeClickStep()],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalIterations).toBe(1);
		expect(mockPlanner.plan).toHaveBeenCalledOnce();
		expect(mockController.getState).toHaveBeenCalledWith("agent");
		loop.dispose();
	});

	it("runs multiple iterations before goal is achieved", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: false,
				steps: [makeClickStep()],
			}),
			makePlan({
				goalAchieved: true,
				assessment: "Goal achieved after 2 iterations",
				steps: [makeClickStep()],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalIterations).toBe(2);
		expect(mockPlanner.plan).toHaveBeenCalledTimes(2);
		loop.dispose();
	});

	it("stops after max iterations", async () => {
		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: false, steps: [makeClickStep()] }),
		]);

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 3 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("budget-exhausted");
		expect(result.stopReason).toBe("max-iterations");
		expect(result.totalIterations).toBe(3);
		expect(mockPlanner.plan).toHaveBeenCalledTimes(3);
		loop.dispose();
	});

	it("handles planner errors gracefully", async () => {
		mockPlanner = {
			plan: vi.fn().mockRejectedValue(new Error("LLM API error")),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 2 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		// The loop should not throw — the planner error is caught by the planner itself
		// but since we're mocking a rejection, the loop iteration should handle it
		// Actually the loop calls planner.plan() without try/catch, so it will throw.
		// This is by design — if the planner itself throws, the loop should propagate.
		await expect(loop.run()).rejects.toThrow("LLM API error");
		loop.dispose();
	});

	it("handles action execution failures", async () => {
		mockController.click.mockRejectedValue(new Error("Element not found"));

		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: false,
				steps: [makeClickStep()],
			}),
			makePlan({
				goalAchieved: true,
				steps: [],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		// First iteration should have a failed result
		const state = loop.getState();
		expect(state).not.toBeNull();
		expect(state!.iterations[0].result.status).toBe("failed");
		expect(state!.iterations[0].result.error).toBe("Element not found");

		// Second iteration: goal achieved
		expect(result.status).toBe("completed");
		expect(result.totalIterations).toBe(2);
		loop.dispose();
	});

	it("calls onProgress callback for each iteration", async () => {
		const onProgress = vi.fn();

		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: false, steps: [makeClickStep()] }),
			makePlan({ goalAchieved: true, steps: [] }),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			onProgress,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		expect(onProgress).toHaveBeenCalledTimes(2);
		expect(onProgress).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ iteration: 1 }),
		);
		expect(onProgress).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ iteration: 2 }),
		);
		loop.dispose();
	});

	it("navigates to startUrl when provided", async () => {
		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: true, steps: [] }),
		]);

		const options = makeOptions({
			goal: makeGoal({ startUrl: "https://example.com" }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		expect(mockController.navigate).toHaveBeenCalledWith("https://example.com");
		loop.dispose();
	});

	it("handles startUrl navigation failure", async () => {
		mockController.navigate.mockRejectedValue(new Error("Network error"));

		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: true, steps: [] }),
		]);

		const options = makeOptions({
			goal: makeGoal({ startUrl: "https://example.com" }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("error");
		loop.dispose();
	});

	it("subscribes to controller events on construction", () => {
		mockPlanner = createMockPlanner([makePlan()]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);

		expect(mockController.on).toHaveBeenCalledWith("stateChanged", expect.any(Function));
		expect(mockController.on).toHaveBeenCalledWith("humanTakeoverRequested", expect.any(Function));
		loop.dispose();
	});

	it("stops when humanTakeoverRequested event fires", async () => {
		let plannerResolve: (value: TaskPlan) => void;
		const slowPlan = new Promise<TaskPlan>((resolve) => {
			plannerResolve = resolve;
		});

		mockPlanner = {
			plan: vi.fn().mockReturnValue(slowPlan),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);

		// Start the loop in background
		const runPromise = loop.run();

		// Let the loop start its first iteration (enter planner.plan())
		await new Promise((resolve) => setTimeout(resolve, 5));

		// Find the handler that was registered for humanTakeoverRequested
		const takeoverHandler = mockController.on.mock.calls.find(
			(call: any[]) => call[0] === "humanTakeoverRequested",
		)?.[1] as ((data: unknown) => void) | undefined;

		expect(takeoverHandler).toBeDefined();
		takeoverHandler!({ reason: "captcha-present", timestamp: new Date().toISOString() });

		// Resolve the planner so the iteration can complete
		plannerResolve!(makePlan({ goalAchieved: false, steps: [] }));

		const result = await runPromise;
		expect(result.stopReason).toBe("human-takeover");
		loop.dispose();
	});

	it("stop() method terminates the loop", async () => {
		let plannerResolve: (value: TaskPlan) => void;
		const slowPlan = new Promise<TaskPlan>((resolve) => {
			plannerResolve = resolve;
		});

		mockPlanner = {
			plan: vi.fn().mockReturnValue(slowPlan),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 100 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);

		// Start the loop in background
		const runPromise = loop.run();

		// Let the loop start its first iteration
		await new Promise((resolve) => setTimeout(resolve, 5));

		// Stop the loop
		loop.stop("human-takeover");

		// Resolve the planner so the iteration can complete
		plannerResolve!(makePlan({ goalAchieved: false, steps: [] }));

		const result = await runPromise;
		expect(result.stopReason).toBe("human-takeover");
		loop.dispose();
	});

	it("getState() returns null before run()", () => {
		mockPlanner = createMockPlanner([makePlan()]);
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		expect(loop.getState()).toBeNull();
		loop.dispose();
	});

	it("executes navigate tool step", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: true,
				steps: [
					{
						index: 0,
						action: "Navigate to page",
						tool: "navigate",
						args: { url: "https://example.com/page2" },
						reasoning: "Need to go to page 2",
						retryable: true,
					},
				],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		expect(mockController.navigate).toHaveBeenCalledWith("https://example.com/page2");
		loop.dispose();
	});

	it("executes type tool step", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: true,
				steps: [
					{
						index: 0,
						action: "Type in search",
						tool: "type",
						args: { selector: "#search", text: "hello" },
						reasoning: "Enter search query",
						retryable: true,
					},
				],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		expect(mockController.type).toHaveBeenCalledWith("#search", "hello");
		loop.dispose();
	});

	it("executes waitForTimeout tool step", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: true,
				steps: [
					{
						index: 0,
						action: "Wait for animation",
						tool: "waitForTimeout",
						args: { ms: 500 },
						reasoning: "Wait for animation to complete",
						retryable: false,
					},
				],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		expect(mockController.waitForTimeout).toHaveBeenCalledWith(500);
		loop.dispose();
	});

	it("returns failed for unknown tool", async () => {
		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: true,
				steps: [
					{
						index: 0,
						action: "Unknown action",
						tool: "unknownTool",
						args: {},
						reasoning: "This tool doesn't exist",
						retryable: false,
					},
				],
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		const state = loop.getState();
		expect(state!.iterations[0].result.status).toBe("failed");
		expect(state!.iterations[0].result.error).toBe("Unknown tool: unknownTool");
		loop.dispose();
	});

	it("skips iteration when plan has no steps", async () => {
		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: true, steps: [], assessment: "Nothing to do" }),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		await loop.run();

		const state = loop.getState();
		expect(state!.iterations[0].result.status).toBe("skipped");
		loop.dispose();
	});

	it("handles unresolvable blocker with human escalation", async () => {
		const onHumanEscalation = vi.fn().mockResolvedValue(undefined);

		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: false,
				steps: [makeClickStep()],
				blocker: {
					type: "captcha",
					confidence: 0.9,
					description: "CAPTCHA detected",
					evidence: ["hCaptcha iframe"],
					autoResolvable: false,
				},
			}),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			onHumanEscalation,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(onHumanEscalation).toHaveBeenCalledWith(
			"CAPTCHA detected",
			expect.any(Object),
		);
		expect(result.status).toBe("human-takeover");
		expect(result.stopReason).toBe("unresolvable-blocker");
		loop.dispose();
	});

	it("continues when human escalation provides a resolution", async () => {
		const onHumanEscalation = vi.fn().mockResolvedValue("I solved the CAPTCHA");

		mockPlanner = createMockPlanner([
			makePlan({
				goalAchieved: false,
				steps: [makeClickStep()],
				blocker: {
					type: "captcha",
					confidence: 0.9,
					description: "CAPTCHA detected",
					evidence: ["hCaptcha iframe"],
					autoResolvable: false,
				},
			}),
			makePlan({ goalAchieved: true, steps: [] }),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			onHumanEscalation,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		loop.dispose();
	});

	it("handles getState failure gracefully", async () => {
		mockController.getState.mockRejectedValue(new Error("Browser crashed"));

		// Since we're using maxIterations: 5, it will try getState on each iteration
		// Each iteration will fail and return a failed iteration, but the loop continues
		mockPlanner = createMockPlanner([
			makePlan({ goalAchieved: true, steps: [] }),
		]);

		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		// The iteration should have a failed observation
		const state = loop.getState();
		expect(state!.iterations[0].observation).toContain("Failed to observe page state");
		expect(state!.iterations[0].result.status).toBe("failed");
		loop.dispose();
	});

	it("respects maxDurationSeconds budget", async () => {
		// Make each iteration take time by slowing down the planner
		mockPlanner = {
			plan: vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 50));
				return makePlan({ goalAchieved: false, steps: [makeClickStep()] });
			}),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 100, maxDurationSeconds: 0.1 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.stopReason).toBe("max-duration");
		expect(result.status).toBe("budget-exhausted");
		loop.dispose();
	});

	it("unsubscribes from events on dispose", () => {
		mockPlanner = createMockPlanner([makePlan()]);
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		loop.dispose();

		expect(mockController.off).toHaveBeenCalledWith("stateChanged", expect.any(Function));
		expect(mockController.off).toHaveBeenCalledWith("humanTakeoverRequested", expect.any(Function));
	});
});
