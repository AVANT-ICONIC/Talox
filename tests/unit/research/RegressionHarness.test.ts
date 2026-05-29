import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { LoopResult } from "../../../src/core/loop/types.js";
import { RegressionHarness } from "../../../src/core/research/RegressionHarness.js";
import type { AutoResearchConfig } from "../../../src/core/research/types.js";

const defaultConfig: AutoResearchConfig = {
	runsPerVariant: 3,
	promotionThreshold: 0.15,
	excludedDomains: [],
	persistToDisk: false,
	researchDir: "/tmp/talox-test-regression",
	maxConcurrentExperiments: 1,
	enableCrossDomainTransfer: true,
	enablePromptEvolution: true,
	maxSkillVersions: 10,
	regressionTimeoutMs: 60_000,
	adaptivePriority: true,
	compositionConfidenceThreshold: 0.7,
};

function makeLoopResult(overrides: Partial<LoopResult> = {}): LoopResult {
	return {
		status: "completed",
		goal: { description: "test", maxIterations: 10 },
		totalIterations: 3,
		totalDurationMs: 500,
		totalCostUsd: 0.01,
		createdSkills: [],
		stopReason: "goal-achieved",
		...overrides,
	};
}

describe("RegressionHarness", () => {
	let harness: RegressionHarness;

	beforeEach(() => {
		harness = new RegressionHarness(defaultConfig);
	});

	it("starts with no test cases", () => {
		expect(harness.getTestCases()).toEqual([]);
	});

	it("adds a test case with generated id", () => {
		const tc = harness.addTestCase({
			name: "login-page",
			goal: "navigate to login page",
			domain: "example.com",
			expectedMaxIterations: 5,
			expectedMaxDurationMs: 5000,
		});
		expect(tc.id).toBeTruthy();
		expect(tc.status).toBe("unknown");
		expect(tc.lastRunMetrics).toBeNull();
	});

	it("removes a test case by id", () => {
		const tc = harness.addTestCase({
			name: "test-case",
			goal: "test goal",
			domain: "example.com",
			expectedMaxIterations: 5,
			expectedMaxDurationMs: 5000,
		});
		expect(harness.removeTestCase(tc.id)).toBe(true);
		expect(harness.getTestCases()).toHaveLength(0);
	});

	it("removeTestCase returns false for unknown id", () => {
		expect(harness.removeTestCase("nonexistent")).toBe(false);
	});

	it("runSuite runs all test cases", async () => {
		harness.addTestCase({
			name: "test-1",
			goal: "goal 1",
			domain: "a.com",
			expectedMaxIterations: 5,
			expectedMaxDurationMs: 5000,
		});
		harness.addTestCase({
			name: "test-2",
			goal: "goal 2",
			domain: "b.com",
			expectedMaxIterations: 10,
			expectedMaxDurationMs: 10000,
		});

		const mockLoop = { run: vi.fn().mockResolvedValue(makeLoopResult()) } as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const results = await harness.runSuite(factory);
		expect(results).toHaveLength(2);
		expect(results.every((r) => r.passed)).toBe(true);
	});

	it("detects regression when iterations exceed expected", async () => {
		harness.addTestCase({
			name: "iter-test",
			goal: "goal",
			domain: "a.com",
			expectedMaxIterations: 2,
			expectedMaxDurationMs: 60000,
		});

		const mockLoop = {
			run: vi.fn().mockResolvedValue(makeLoopResult({ totalIterations: 20 })),
		} as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const results = await harness.runSuite(factory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions.length).toBeGreaterThan(0);
	});

	it("detects regression when wall-clock duration exceeds expected", async () => {
		harness.addTestCase({
			name: "duration-test",
			goal: "goal",
			domain: "a.com",
			expectedMaxIterations: 100,
			expectedMaxDurationMs: 1, // 1ms — real delay will exceed this
		});

		const mockLoop = {
			run: vi.fn().mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 50)); // 50ms wall-clock
				return makeLoopResult();
			}),
		} as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const results = await harness.runSuite(factory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions.some((r) => r.includes("Duration"))).toBe(true);
	});

	it("detects regression when goal not achieved", async () => {
		harness.addTestCase({
			name: "goal-test",
			goal: "goal",
			domain: "a.com",
			expectedMaxIterations: 100,
			expectedMaxDurationMs: 60000,
		});

		const mockLoop = {
			run: vi.fn().mockResolvedValue(makeLoopResult({ status: "failed" })),
		} as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const results = await harness.runSuite(factory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions).toContain("Goal not achieved");
	});

	it("detects regression from previous run", async () => {
		const tc = harness.addTestCase({
			name: "prev-run-test",
			goal: "goal",
			domain: "a.com",
			expectedMaxIterations: 100,
			expectedMaxDurationMs: 60000,
		});

		// Simulate a previous good run
		tc.lastRunMetrics = {
			iterationsToGoal: 3,
			totalDurationMs: 500,
			totalCostUsd: 0.01,
			blockerCount: 0,
			blockerTypes: [],
			goalAchieved: true,
			skillsCreated: 0,
			strategySuccessRate: 1.0,
		};

		// Now run with much worse results — 50 > 3*1.5 = 4.5 → regression
		const mockLoop = {
			run: vi.fn().mockResolvedValue(makeLoopResult({ totalIterations: 50 })),
		} as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const results = await harness.runSuite(factory);
		expect(results[0]!.passed).toBe(false);
	});

	it("handles loop factory errors gracefully", async () => {
		harness.addTestCase({
			name: "error-test",
			goal: "goal",
			domain: "a.com",
			expectedMaxIterations: 100,
			expectedMaxDurationMs: 60000,
		});

		const factory = vi.fn().mockRejectedValue(new Error("boom"));

		const results = await harness.runSuite(factory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions[0]).toContain("Test execution failed");
	});

	it("getFailingTests returns only failing", async () => {
		harness.addTestCase({
			name: "good",
			goal: "good",
			domain: "a.com",
			expectedMaxIterations: 100,
			expectedMaxDurationMs: 60000,
		});
		harness.addTestCase({
			name: "bad",
			goal: "bad",
			domain: "b.com",
			expectedMaxIterations: 1,
			expectedMaxDurationMs: 1,
		});

		const mockLoop = {
			run: vi.fn().mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 10)); // ensure wall-clock > 1ms
				return makeLoopResult({ totalIterations: 10 });
			}),
		} as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		await harness.runSuite(factory);
		const failing = harness.getFailingTests();
		const passing = harness.getPassingTests();

		expect(failing.length).toBeGreaterThan(0);
		expect(passing.length).toBeGreaterThan(0);
	});

	it("runSuite returns empty array for no test cases", async () => {
		const results = await harness.runSuite(vi.fn());
		expect(results).toEqual([]);
	});
});
