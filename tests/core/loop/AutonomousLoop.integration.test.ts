/**
 * @file AutonomousLoop.integration.test.ts
 * @description Integration tests for AutonomousLoop with real Chromium.
 * Uses plannerOverride (mock Planner) to avoid needing a real LLM API key,
 * but exercises real browser interactions via TaloxController.
 *
 * Uses describe.serial to run tests sequentially (shared browser).
 * Tests auto-skip if Chromium is not installed.
 */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../../src/core/controller/TaloxController.js";
import { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { Planner } from "../../../src/core/loop/Planner.js";
import type { AutonomousLoopOptions, LoopIteration, PlanStep, TaskPlan } from "../../../src/core/loop/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

/** Create a mock Planner that returns the given plans in sequence. */
function createMockPlanner(plans: TaskPlan[]): Planner {
	let callIndex = 0;
	return {
		plan: vi.fn(async () => {
			const plan = plans[Math.min(callIndex, plans.length - 1)];
			callIndex++;
			return plan;
		}),
	};
}

function makePlan(overrides?: Partial<TaskPlan>): TaskPlan {
	return { assessment: "Test", steps: [], goalAchieved: false, ...overrides };
}

function makeClickStep(selector = "#btn"): PlanStep {
	return { index: 0, action: "Click", tool: "click", args: { selector }, reasoning: "test", retryable: true };
}

function makeTypeStep(selector: string, text: string): PlanStep {
	return { index: 0, action: `Type`, tool: "type", args: { selector, text }, reasoning: "test", retryable: true };
}

function makeNavigateStep(url: string): PlanStep {
	return { index: 0, action: "Navigate", tool: "navigate", args: { url }, reasoning: "test", retryable: true };
}

function makeGetStateStep(): PlanStep {
	return { index: 0, action: "Observe", tool: "getState", args: {}, reasoning: "test", retryable: false };
}

function makeOptions(planner: Planner, overrides?: Partial<AutonomousLoopOptions>): AutonomousLoopOptions {
	return {
		goal: { description: "Test goal", maxIterations: 5 },
		planner: { model: "test-model" },
		plannerOverride: planner,
		...overrides,
	};
}

function dataUri(html: string): string {
	return `data:text/html,${encodeURIComponent(html)}`;
}

// ── Suite (serial — shared browser) ──────────────────────────────────────────

// @vitest-environment node
// Runs sequentially via vitest config poolOptions

describe("AutonomousLoop integration", () => {
	let controller: TaloxController;
	let browserAvailable = true;

	beforeAll(async () => {
		controller = new TaloxController(path.join(__dirname, "../../temp-profiles"), {
			settings: {
				safeMode: true,
				automaticThinkingEnabled: false,
				humanStealth: 0,
				fidgetEnabled: false,
				adaptiveStealthEnabled: false,
				typoProbability: 0,
				typingDelayMin: 0,
				typingDelayMax: 0,
			},
		});
		try {
			await controller.launch(`loop-integration-${Date.now()}`, "sandbox");
		} catch (error) {
			if (isMissingBrowserError(error)) {
				browserAvailable = false;
				return;
			}
			throw error;
		}
	});

	afterAll(async () => {
		if (browserAvailable) {
			await controller.stop();
		}
	});

	function itBrowser(name: string, fn: () => Promise<void>) {
		if (!browserAvailable) {
			it.skip(name, fn);
		} else {
			it(name, fn);
		}
	}

	itBrowser("stops immediately on goal achieved with no steps", async () => {
		await controller.navigate("about:blank");
		const planner = createMockPlanner([makePlan({ goalAchieved: true, assessment: "Already done", steps: [] })]);
		const loop = new AutonomousLoop(controller, makeOptions(planner));
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalIterations).toBe(1);
		loop.dispose();
	});

	itBrowser("respects maxIterations budget", async () => {
		await controller.navigate("about:blank");
		const planner = createMockPlanner([makePlan({ goalAchieved: false, steps: [makeGetStateStep()] })]);
		const loop = new AutonomousLoop(
			controller,
			makeOptions(planner, {
				goal: { description: "Budget test", maxIterations: 2 },
			}),
		);
		const result = await loop.run();

		expect(result.status).toBe("budget-exhausted");
		expect(result.stopReason).toBe("max-iterations");
		expect(result.totalIterations).toBe(2);
		loop.dispose();
	});

	itBrowser("emits onProgress callbacks", async () => {
		await controller.navigate("about:blank");
		const progress: LoopIteration[] = [];
		const planner = createMockPlanner([
			makePlan({ goalAchieved: false, steps: [makeGetStateStep()] }),
			makePlan({ goalAchieved: true, steps: [] }),
		]);
		const loop = new AutonomousLoop(
			controller,
			makeOptions(planner, {
				onProgress: (iter) => {
					progress.push(iter);
				},
			}),
		);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(progress.length).toBe(2);
		expect(progress[0].iteration).toBe(1);
		expect(progress[1].iteration).toBe(2);
		loop.dispose();
	});

	itBrowser("executes navigate step", async () => {
		const planner = createMockPlanner([makePlan({ goalAchieved: true, steps: [makeNavigateStep("about:blank")] })]);
		const loop = new AutonomousLoop(controller, makeOptions(planner));
		const result = await loop.run();

		expect(result.status).toBe("completed");
		loop.dispose();
	});

	itBrowser("executes click and type steps on real page", async () => {
		await controller.navigate(
			dataUri(`<html><body>
			<input id="input" type="text" value="" />
			<button id="btn" onclick="document.title='clicked'">Go</button>
		</body></html>`),
		);

		const planner: Planner = {
			plan: vi.fn(async (_input) => {
				const callCount = (planner.plan as ReturnType<typeof vi.fn>).mock.calls.length;
				if (callCount === 1) {
					return makePlan({ goalAchieved: false, steps: [makeTypeStep("#input", "hello")] });
				}
				return makePlan({ goalAchieved: true, steps: [makeClickStep("#btn")] });
			}),
		};

		const loop = new AutonomousLoop(controller, makeOptions(planner));
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.totalIterations).toBe(2);
		loop.dispose();
	});

	itBrowser("recovery from failed step then success", async () => {
		await controller.navigate(
			dataUri(`<html><body>
			<button id="btn">Go</button>
		</body></html>`),
		);

		// Use a step tool that actually throws — navigate to an invalid URL
		// TaloxController.click() swallows errors (returns error state, doesn't throw),
		// so AutonomousLoop sees "success" even for missing selectors.
		// Instead, use a waitForSelector with a short timeout on a missing element.
		const failStep: PlanStep = {
			index: 0,
			action: "WaitForSelector",
			tool: "waitForSelector",
			args: { selector: "#nonexistent", timeout: 100 },
			reasoning: "test — should fail fast",
			retryable: true,
		};

		const planner = createMockPlanner([
			makePlan({ goalAchieved: false, steps: [failStep] }),
			makePlan({ goalAchieved: true, steps: [makeClickStep("#btn")] }),
		]);
		const loop = new AutonomousLoop(controller, makeOptions(planner));
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.totalIterations).toBe(2);
		const state = loop.getState();
		expect(state!.iterations[0].result.status).toBe("failed");
		expect(state!.iterations[1].result.status).toBe("success");
		loop.dispose();
	});

	itBrowser("loop state tracks all iterations", async () => {
		await controller.navigate("about:blank");
		const planner = createMockPlanner([
			makePlan({ goalAchieved: false, steps: [makeGetStateStep()] }),
			makePlan({ goalAchieved: false, steps: [makeGetStateStep()] }),
			makePlan({ goalAchieved: true, steps: [] }),
		]);
		const loop = new AutonomousLoop(controller, makeOptions(planner));

		expect(loop.getState()).toBeNull();
		await loop.run();

		const state = loop.getState();
		expect(state!.iterations.length).toBe(3);
		expect(state!.currentIteration).toBe(3);
		expect(state!.status).toBe("completed");
		for (const iter of state!.iterations) {
			expect(iter.timestamp).toBeDefined();
			expect(iter.iteration).toBeGreaterThan(0);
		}
		loop.dispose();
	});

	itBrowser("handles startUrl in goal", async () => {
		const planner = createMockPlanner([makePlan({ goalAchieved: true, steps: [] })]);
		const loop = new AutonomousLoop(
			controller,
			makeOptions(planner, {
				goal: { description: "Navigate test", startUrl: "about:blank", maxIterations: 5 },
			}),
		);
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		loop.dispose();
	});
});
