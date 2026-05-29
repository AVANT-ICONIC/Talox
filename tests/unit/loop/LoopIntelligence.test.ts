/**
 * @file LoopIntelligence.test.ts
 * @description Unit tests for the loop intelligence features in AutonomousLoop:
 *   - isStuck() convergence detection
 *   - handleStuckLoop() stuck-loop recovery
 *   - generateSkillFromBlocker() LLM skill generation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { Planner } from "../../../src/core/loop/Planner.js";
import type {
	AutonomousLoopOptions,
	BlockerClassification,
	DynamicSkill,
	LoopIteration,
	PlanStep,
	TaskPlan,
} from "../../../src/core/loop/types.js";

// ── Mock Factories ──────────────────────────────────────────────────────────

const { createMockController, createMockPlanner, makeGoal, makePlan, makePageState, makeFailedIteration, makeBlocker } =
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
				generateSkill: vi.fn(async () => null as DynamicSkill | null),
			};
		}

		function makeGoal(overrides?: Partial<AutonomousLoopOptions["goal"]>): AutonomousLoopOptions["goal"] {
			return {
				description: "Test goal",
				maxIterations: 10,
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

		/** Build a LoopIteration with a failed result and optional error. */
		function makeFailedIteration(iterationNumber: number, overrides?: Partial<LoopIteration>): LoopIteration {
			return {
				iteration: iterationNumber,
				observation: "Test observation",
				plan: makePlan(),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
				timestamp: new Date().toISOString(),
				...overrides,
			};
		}

		/** Build a BlockerClassification for testing. */
		function makeBlocker(overrides?: Partial<BlockerClassification>): BlockerClassification {
			return {
				type: "element-not-found",
				confidence: 0.9,
				description: "Element not found on page",
				evidence: ["selector #submit not found"],
				autoResolvable: false,
				...overrides,
			};
		}

		return {
			createMockController,
			createMockPlanner,
			makeGoal,
			makePlan,
			makePageState,
			makeFailedIteration,
			makeBlocker,
		};
	});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOptions(overrides?: Partial<AutonomousLoopOptions>): AutonomousLoopOptions {
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

/**
 * Create an AutonomousLoop and seed its internal state with the given
 * iterations so private methods like isStuck() can inspect them.
 * Initializes state if it hasn't been created yet (i.e. run() not called).
 */
function seedLoopState(loop: AutonomousLoop, iterations: LoopIteration[]): void {
	if (!(loop as any).state) {
		(loop as any).state = (loop as any).createInitialState();
	}
	const state = (loop as any).state;
	state.iterations = iterations;
	state.currentIteration = iterations.length;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LoopIntelligence — isStuck()", () => {
	let mockController: ReturnType<typeof createMockController>;
	let mockPlanner: ReturnType<typeof createMockPlanner>;

	beforeEach(() => {
		mockController = createMockController();
		mockController.getState.mockResolvedValue(makePageState());
		mockController.getChallengeState.mockResolvedValue({
			hasChallenge: false,
			challenges: [],
			primaryChallenge: null,
		});
		mockController.navigate.mockResolvedValue(makePageState());
		mockController.click.mockResolvedValue(makePageState());
		mockController.type.mockResolvedValue(makePageState());
		mockPlanner = createMockPlanner([makePlan()]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("detects stuck loop after 3 consecutive failed iterations with same error", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// Seed 3 iterations with same error
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(true);
		loop.dispose();
	});

	it("detects stuck loop with same blocker type across 3 iterations", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const blocker = makeBlocker({ type: "captcha" });

		seedLoopState(loop, [
			makeFailedIteration(1, {
				plan: makePlan({ blocker }),
				result: { status: "failed", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				plan: makePlan({ blocker }),
				result: { status: "failed", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: { status: "failed", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(true);
		loop.dispose();
	});

	it("detects stuck loop with blocked status and same blocker type", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const blocker = makeBlocker({ type: "cloudflare" });

		seedLoopState(loop, [
			makeFailedIteration(1, {
				plan: makePlan({ blocker }),
				result: { status: "blocked", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				plan: makePlan({ blocker }),
				result: { status: "blocked", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: { status: "blocked", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(true);
		loop.dispose();
	});

	it("does not detect stuck with fewer than 3 iterations", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Same error", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Same error", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});

	it("does not detect stuck when errors differ", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Error A", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Error B", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				result: { status: "failed", error: "Error C", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});

	it("does not detect stuck when statuses are mixed (failed + success)", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "success", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Same error", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				result: { status: "failed", error: "Same error", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});

	it("does not detect stuck when blocker types differ", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				plan: makePlan({ blocker: makeBlocker({ type: "captcha" }) }),
				result: { status: "failed", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				plan: makePlan({ blocker: makeBlocker({ type: "cloudflare" }) }),
				result: { status: "failed", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker: makeBlocker({ type: "login-wall" }) }),
				result: { status: "failed", durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});

	it("returns false when internal state is null", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// state is null before run()
		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});

	it("detects stuck when errors match in first 80 characters even if longer", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const longErrorA =
			"Element not found: the selector '#submit-button' could not be resolved in the DOM after exhaustive search part A";
		const longErrorB =
			"Element not found: the selector '#submit-button' could not be resolved in the DOM after exhaustive search part B";

		// First 80 chars are the same
		expect(longErrorA.slice(0, 80)).toBe(longErrorB.slice(0, 80));

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: longErrorA, durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: longErrorA, durationMs: 10 },
			}),
			makeFailedIteration(3, {
				result: { status: "failed", error: longErrorB, durationMs: 10 },
			}),
		]);

		expect((loop as any).isStuck()).toBe(true);
		loop.dispose();
	});

	it("does not detect stuck when only 1 of 3 has an error", () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Some error", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				result: { status: "failed", durationMs: 10 },
			}),
		]);

		// Only 1 iteration has an error, so errors.length < 2
		expect((loop as any).isStuck()).toBe(false);
		loop.dispose();
	});
});

describe("LoopIntelligence — handleStuckLoop()", () => {
	let mockController: ReturnType<typeof createMockController>;
	let mockPlanner: ReturnType<typeof createMockPlanner>;

	beforeEach(() => {
		mockController = createMockController();
		mockController.getState.mockResolvedValue(makePageState());
		mockController.getChallengeState.mockResolvedValue({
			hasChallenge: false,
			challenges: [],
			primaryChallenge: null,
		});
		mockController.navigate.mockResolvedValue(makePageState());
		mockController.click.mockResolvedValue(makePageState());
		mockController.type.mockResolvedValue(makePageState());
		mockPlanner = createMockPlanner([makePlan()]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("stops loop when no skill writer available and no human escalation", async () => {
		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
			// No skillsDir → skillWriter is null
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// Seed state with 3 stuck iterations including a blocker and error
		const blocker = makeBlocker({ type: "element-not-found" });
		seedLoopState(loop, [
			makeFailedIteration(1, {
				plan: makePlan({ blocker }),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				plan: makePlan({ blocker }),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
		]);

		await (loop as any).handleStuckLoop();

		const state = loop.getState();
		expect(state).not.toBeNull();
		expect(state!.status).toBe("failed");
		expect(state!.stopReason).toBe("unresolvable-blocker");
		loop.dispose();
	});

	it("continues loop when human escalation provides a resolution", async () => {
		const onHumanEscalation = vi.fn().mockResolvedValue("I fixed the element");

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
			onHumanEscalation,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const blocker = makeBlocker();
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
		]);

		await (loop as any).handleStuckLoop();

		const state = loop.getState();
		// Loop should still be running — human provided resolution
		expect(state!.status).toBe("running");
		expect(onHumanEscalation).toHaveBeenCalledTimes(1);
		loop.dispose();
	});

	it("stops loop when human escalation provides no resolution", async () => {
		const onHumanEscalation = vi.fn().mockResolvedValue(undefined);

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
			onHumanEscalation,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const blocker = makeBlocker();
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
		]);

		await (loop as any).handleStuckLoop();

		const state = loop.getState();
		expect(state!.status).toBe("failed");
		expect(state!.stopReason).toBe("unresolvable-blocker");
		loop.dispose();
	});

	it("attempts skill generation when skillWriter exists and blocker is present", async () => {
		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// Mock the skillWriter that was created internally
		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/talox-test-skills/example.com/SKILL.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		// Mock planner.generateSkill to return a valid DynamicSkill
		const generatedSkill: DynamicSkill = {
			name: "handle-element-not-found",
			description: "Skill for handling missing elements",
			domain: "example.com",
			version: "1.0",
			content: "# Handle missing elements\n\nWait and retry.",
			triggerCondition: 'blocker type == "element-not-found"',
			toolUsage: ["waitForSelector", "click"],
		};
		mockPlanner.generateSkill.mockResolvedValue(generatedSkill);

		const blocker = makeBlocker();
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Element not found", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				plan: makePlan({ blocker }),
				result: {
					status: "failed",
					error: "Element not found",
					durationMs: 10,
					state: { url: "https://example.com/page" } as any,
				},
			}),
		]);

		await (loop as any).handleStuckLoop();

		// Planner should have been called to generate a skill
		expect(mockPlanner.generateSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				blockerType: "element-not-found",
				blockerDescription: blocker.description,
				evidence: blocker.evidence,
			}),
		);

		// SkillWriter should have been called to write the skill
		expect(mockSkillWriter.createSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "handle-element-not-found",
				domain: "example.com",
			}),
		);

		// Skill should be validated
		expect(mockSkillWriter.validateSkill).toHaveBeenCalledWith("handle-element-not-found");

		// State should track the created skill
		const state = loop.getState();
		expect(state!.createdSkills).toContain("handle-element-not-found");

		// Loop should still be running — skill was created
		expect(state!.status).toBe("running");
		loop.dispose();
	});

	it("does not attempt skill generation when no blocker in last iteration", async () => {
		const onHumanEscalation = vi.fn().mockResolvedValue(undefined);

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
			onHumanEscalation,
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/skill.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		// Seed iterations WITHOUT a blocker in the last one
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Timeout", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				result: { status: "failed", error: "Timeout", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				// No blocker on last iteration
				result: { status: "failed", error: "Timeout", durationMs: 10 },
			}),
		]);

		await (loop as any).handleStuckLoop();

		// generateSkill should NOT have been called (no blocker)
		expect(mockPlanner.generateSkill).not.toHaveBeenCalled();

		// Should fall through to human escalation check (which returns undefined)
		// and then stop the loop
		const state = loop.getState();
		expect(state!.status).toBe("failed");
		expect(state!.stopReason).toBe("unresolvable-blocker");
		loop.dispose();
	});
});

describe("LoopIntelligence — generateSkillFromBlocker()", () => {
	let mockController: ReturnType<typeof createMockController>;
	let mockPlanner: ReturnType<typeof createMockPlanner>;

	beforeEach(() => {
		mockController = createMockController();
		mockController.getState.mockResolvedValue(makePageState());
		mockController.getChallengeState.mockResolvedValue({
			hasChallenge: false,
			challenges: [],
			primaryChallenge: null,
		});
		mockController.navigate.mockResolvedValue(makePageState());
		mockController.click.mockResolvedValue(makePageState());
		mockController.type.mockResolvedValue(makePageState());
		mockPlanner = createMockPlanner([makePlan()]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns false when planner.generateSkill returns null", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// Mock skillWriter
		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/skill.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		// Seed state so generateSkillFromBlocker has iterations to work with
		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: {
					status: "failed",
					error: "Element not found",
					durationMs: 10,
					state: { url: "https://example.com/page" } as any,
				},
			}),
		]);

		// Planner returns null
		mockPlanner.generateSkill.mockResolvedValue(null);

		const blocker = makeBlocker();
		const result = await (loop as any).generateSkillFromBlocker(blocker);

		expect(result).toBe(false);
		expect(mockSkillWriter.createSkill).not.toHaveBeenCalled();
		loop.dispose();
	});

	it("returns false when skillWriter is null", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			// No skillsDir → skillWriter is null
		});
		const loop = new AutonomousLoop(mockController as any, options);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Error", durationMs: 10 },
			}),
		]);

		const blocker = makeBlocker();
		const result = await (loop as any).generateSkillFromBlocker(blocker);

		expect(result).toBe(false);
		loop.dispose();
	});

	it("returns false when state is null", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		// state is null before run()
		const blocker = makeBlocker();
		const result = await (loop as any).generateSkillFromBlocker(blocker);

		expect(result).toBe(false);
		loop.dispose();
	});

	it("returns false and catches exceptions from planner.generateSkill", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/skill.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: { status: "failed", error: "Error", durationMs: 10 },
			}),
		]);

		// Planner throws
		mockPlanner.generateSkill.mockRejectedValue(new Error("LLM API timeout"));

		const blocker = makeBlocker();
		const result = await (loop as any).generateSkillFromBlocker(blocker);

		expect(result).toBe(false);
		loop.dispose();
	});

	it("returns false when skill validation fails", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/skill.md"),
			validateSkill: vi.fn(async () => false), // Validation fails
		};
		(loop as any).skillWriter = mockSkillWriter;

		const generatedSkill: DynamicSkill = {
			name: "test-skill",
			description: "Test",
			domain: "example.com",
			version: "1.0",
			content: "# Test",
			triggerCondition: "test",
			toolUsage: [],
		};
		mockPlanner.generateSkill.mockResolvedValue(generatedSkill);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				result: {
					status: "failed",
					error: "Error",
					durationMs: 10,
					state: { url: "https://example.com/page" } as any,
				},
			}),
		]);

		const blocker = makeBlocker();
		const result = await (loop as any).generateSkillFromBlocker(blocker);

		expect(result).toBe(false);
		// Skill should not be added to createdSkills
		const state = loop.getState();
		expect(state!.createdSkills).not.toContain("test-skill");
		loop.dispose();
	});

	it("builds correct recentHistory from last 3 iterations", async () => {
		const options = makeOptions({
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});
		const loop = new AutonomousLoop(mockController as any, options);

		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/skill.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		const generatedSkill: DynamicSkill = {
			name: "history-skill",
			description: "Skill from history",
			domain: "example.com",
			version: "1.0",
			content: "# Test",
			triggerCondition: "test",
			toolUsage: [],
		};
		mockPlanner.generateSkill.mockResolvedValue(generatedSkill);

		seedLoopState(loop, [
			makeFailedIteration(1, {
				observation: "Page loaded",
				result: { status: "failed", error: "Timeout", durationMs: 10 },
			}),
			makeFailedIteration(2, {
				observation: "Still loading",
				result: { status: "failed", error: "Timeout", durationMs: 10 },
			}),
			makeFailedIteration(3, {
				observation: "Timed out again",
				result: {
					status: "failed",
					error: "Timeout",
					durationMs: 10,
					state: { url: "https://example.com/page" } as any,
				},
			}),
		]);

		const blocker = makeBlocker();
		await (loop as any).generateSkillFromBlocker(blocker);

		// Verify planner was called with history containing all 3 iterations
		expect(mockPlanner.generateSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				recentHistory: expect.stringContaining("Iteration 1: Page loaded"),
			}),
		);
		expect(mockPlanner.generateSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				recentHistory: expect.stringContaining("Iteration 2: Still loading"),
			}),
		);
		expect(mockPlanner.generateSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				recentHistory: expect.stringContaining("Iteration 3: Timed out again"),
			}),
		);
		loop.dispose();
	});
});

describe("LoopIntelligence — convergence detection wired into run()", () => {
	let mockController: ReturnType<typeof createMockController>;

	beforeEach(() => {
		mockController = createMockController();
		mockController.getState.mockResolvedValue(makePageState());
		mockController.getChallengeState.mockResolvedValue({
			hasChallenge: false,
			challenges: [],
			primaryChallenge: null,
		});
		mockController.navigate.mockResolvedValue(makePageState());
		mockController.click.mockResolvedValue(makePageState());
		mockController.type.mockResolvedValue(makePageState());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("stops loop after 3 stuck iterations with same error", async () => {
		// All iterations return same plan with goalAchieved:false and click step that fails
		mockController.click.mockRejectedValue(new Error("Element #submit not found"));

		const mockPlanner = {
			plan: vi.fn(async () =>
				makePlan({
					goalAchieved: false,
					steps: [makeClickStep()],
				}),
			),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 20 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		// Should stop due to stuck loop (not max iterations)
		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("unresolvable-blocker");
		// Should have run exactly 3 iterations before detecting stuck
		expect(result.totalIterations).toBe(3);
		loop.dispose();
	});

	it("stops loop after 3 blocked iterations with same blocker type", async () => {
		// Click must fail so result.status = "failed" for isStuck to trigger
		mockController.click.mockRejectedValue(new Error("Element not interactable"));

		const blocker = makeBlocker({
			type: "captcha",
			autoResolvable: true, // NOSONAR — must be true so handleBlocker doesn't stop loop early
		});

		const mockPlanner = {
			plan: vi.fn(async () =>
				makePlan({
					goalAchieved: false,
					steps: [makeClickStep()],
					blocker,
				}),
			),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 20 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		// All 3 iterations fail with same error → isStuck triggers via error matching
		// handleStuckLoop: blocker exists but skillWriter is null, no human escalation → stops
		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("unresolvable-blocker");
		expect(result.totalIterations).toBe(3);
		loop.dispose();
	});

	it("continues when stuck but skill generation succeeds", async () => {
		// First 3 iterations: all fail with same error → stuck detected
		// Skill generation succeeds → loop continues
		// 4th iteration: goal achieved

		mockController.click.mockRejectedValue(new Error("Element #submit not found"));

		const blocker = makeBlocker({
			type: "element-not-found",
			autoResolvable: true, // NOSONAR — must be true so handleBlocker doesn't stop loop early
		});

		let planCallCount = 0;
		const mockPlanner = {
			plan: vi.fn(async () => {
				planCallCount++;
				if (planCallCount <= 3) {
					return makePlan({
						goalAchieved: false,
						steps: [makeClickStep()],
						blocker,
					});
				}
				return makePlan({
					goalAchieved: true,
					steps: [],
				});
			}),
			generateSkill: vi.fn(
				async () =>
					({
						name: "auto-fix-element",
						description: "Auto-generated fix",
						domain: "example.com",
						version: "1.0",
						content: "# Fix\n\nRetry with different selector.",
						triggerCondition: 'blocker type == "element-not-found"',
						toolUsage: ["click"],
					}) as DynamicSkill,
			),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 20 }),
			plannerOverride: mockPlanner as unknown as Planner,
			skillsDir: "/tmp/talox-test-skills",
		});

		const loop = new AutonomousLoop(mockController as any, options);

		// Mock skillWriter
		const mockSkillWriter = {
			createSkill: vi.fn(async () => "/tmp/talox-test-skills/example.com/SKILL.md"),
			validateSkill: vi.fn(async () => true),
		};
		(loop as any).skillWriter = mockSkillWriter;

		const result = await loop.run();

		// Should continue past 3 iterations and complete at 4th
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalIterations).toBe(4);
		expect(result.createdSkills).toContain("auto-fix-element");
		loop.dispose();
	});

	it("uses human escalation when stuck and no skill writer", async () => {
		let planCallCount = 0;
		const onHumanEscalation = vi.fn(async (reason: string) => {
			// Provide resolution only on first call
			if (!reason.includes("2nd")) {
				return "I resolved it";
			}
			return undefined;
		});

		const mockPlanner = {
			plan: vi.fn(async () => {
				planCallCount++;
				if (planCallCount <= 3) {
					return makePlan({
						goalAchieved: false,
						steps: [makeClickStep()],
					});
				}
				return makePlan({
					goalAchieved: true,
					steps: [],
				});
			}),
		};

		mockController.click.mockRejectedValue(new Error("Element not found"));

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 20 }),
			plannerOverride: mockPlanner as unknown as Planner,
			onHumanEscalation,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		// Human provided resolution on first stuck detection → loop continues
		// 4th iteration achieves goal
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(onHumanEscalation).toHaveBeenCalled();
		loop.dispose();
	});

	it("does not trigger stuck detection when loop achieves goal within 3 iterations", async () => {
		const mockPlanner = {
			plan: vi.fn(async () =>
				makePlan({
					goalAchieved: true,
					steps: [],
				}),
			),
		};

		const options = makeOptions({
			goal: makeGoal({ maxIterations: 10 }),
			plannerOverride: mockPlanner as unknown as Planner,
		});

		const loop = new AutonomousLoop(mockController as any, options);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalIterations).toBe(1);
		loop.dispose();
	});
});
