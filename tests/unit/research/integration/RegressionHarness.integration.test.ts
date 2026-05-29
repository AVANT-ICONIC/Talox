import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RegressionHarness } from "../../../../src/core/research/RegressionHarness.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { AutoResearchConfig, RunMetrics } from "../../../../src/core/research/types.js";

const defaultConfig: AutoResearchConfig = {
	runsPerVariant: 3,
	promotionThreshold: 0.15,
	excludedDomains: [],
	persistToDisk: true,
	researchDir: "",
	maxConcurrentExperiments: 1,
	enableCrossDomainTransfer: true,
	enablePromptEvolution: false,
	maxSkillVersions: 5,
	regressionTimeoutMs: 60_000,
	adaptivePriority: true,
	compositionConfidenceThreshold: 0.7,
};

describe("RegressionHarness — Integration", () => {
	let harness: RegressionHarness;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "talox-reg-"));
		const config = { ...defaultConfig, researchDir: tmpDir };
		harness = new RegressionHarness(config);
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("adds test cases and retrieves them", () => {
		const tc = harness.addTestCase({
			name: "reddit-login",
			domain: "reddit.com",
			goal: "Navigate to reddit.com and find login button",
			expectedMaxIterations: 5,
			expectedMaxDurationMs: 10_000,
		});

		expect(tc.id).toBeTruthy();
		expect(tc.status).toBe("unknown");
		expect(harness.getTestCases()).toHaveLength(1);
	});

	it("removes test cases by ID", () => {
		const tc = harness.addTestCase({
			name: "test",
			domain: "x.com",
			goal: "load page",
			expectedMaxIterations: 3,
			expectedMaxDurationMs: 5000,
		});

		expect(harness.removeTestCase(tc.id)).toBe(true);
		expect(harness.getTestCases()).toHaveLength(0);
		expect(harness.removeTestCase("nonexistent")).toBe(false);
	});

	it("runs suite and detects passing tests", async () => {
		harness.addTestCase({
			name: "pass-test",
			domain: "pass.com",
			goal: "pass goal",
			expectedMaxIterations: 20,
			expectedMaxDurationMs: 30_000,
		});

		const loopFactory = async () =>
			({
				run: async () => ({
					status: "completed",
					goal: { description: "test", maxIterations: 10 },
					totalIterations: 5,
					totalDurationMs: 2000,
					totalCostUsd: 0.01,
					createdSkills: [],
					stopReason: "goal-achieved",
				}),
			}) as any;

		const results = await harness.runSuite(loopFactory);
		expect(results).toHaveLength(1);
		expect(results[0]!.passed).toBe(true);
		expect(results[0]!.regressions).toHaveLength(0);

		const cases = harness.getTestCases();
		expect(cases[0]!.status).toBe("passing");
	});

	it("detects regressions when iterations exceed expected", async () => {
		harness.addTestCase({
			name: "slow-test",
			domain: "slow.com",
			goal: "slow goal",
			expectedMaxIterations: 3,
			expectedMaxDurationMs: 5000,
		});

		const loopFactory = async () =>
			({
				run: async () => ({
					status: "completed",
					goal: { description: "test", maxIterations: 20 },
					totalIterations: 10,
					totalDurationMs: 3000,
					totalCostUsd: 0.01,
					createdSkills: [],
					stopReason: "goal-achieved",
				}),
			}) as any;

		const results = await harness.runSuite(loopFactory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions.length).toBeGreaterThan(0);
		expect(results[0]!.regressions[0]).toContain("Iterations");
	});

	it("detects regression when previously passing goal now fails", async () => {
		const tc = harness.addTestCase({
			name: "flaky-test",
			domain: "flaky.com",
			goal: "flaky goal",
			expectedMaxIterations: 20,
			expectedMaxDurationMs: 30_000,
		});

		// First run: passes
		const goodFactory = async () =>
			({
				run: async () => ({
					status: "completed",
					goal: { description: "test", maxIterations: 20 },
					totalIterations: 5,
					totalDurationMs: 1000,
					totalCostUsd: 0.01,
					createdSkills: [],
					stopReason: "goal-achieved",
				}),
			}) as any;

		await harness.runSuite(goodFactory);

		// Second run: fails — should detect regression
		const badFactory = async () =>
			({
				run: async () => ({
					status: "failed",
					goal: { description: "test", maxIterations: 20 },
					totalIterations: 10,
					totalDurationMs: 5000,
					totalCostUsd: 0.05,
					createdSkills: [],
					stopReason: "max-iterations",
				}),
			}) as any;

		const results = await harness.runSuite(badFactory);
		expect(results[0]!.passed).toBe(false);
		expect(results[0]!.regressions).toContain("Previously passing goal now fails");
	});

	it("persists test suite to disk", async () => {
		harness.addTestCase({
			name: "persist-test",
			domain: "p.com",
			goal: "persist goal",
			expectedMaxIterations: 5,
			expectedMaxDurationMs: 5000,
		});
		await harness.save();

		const harness2 = new RegressionHarness({ ...defaultConfig, researchDir: tmpDir });
		await harness2.load();
		expect(harness2.getTestCases()).toHaveLength(1);
		expect(harness2.getTestCases()[0]!.name).toBe("persist-test");
	});

	it("filters passing and failing tests", async () => {
		harness.addTestCase({
			name: "good",
			domain: "g.com",
			goal: "g",
			expectedMaxIterations: 20,
			expectedMaxDurationMs: 30_000,
		});
		harness.addTestCase({
			name: "bad",
			domain: "b.com",
			goal: "b",
			expectedMaxIterations: 1,
			expectedMaxDurationMs: 500,
		});

		const loopFactory = async () =>
			({
				run: async () => ({
					status: "completed",
					goal: { description: "test", maxIterations: 20 },
					totalIterations: 5,
					totalDurationMs: 2000,
					totalCostUsd: 0.01,
					createdSkills: [],
					stopReason: "goal-achieved",
				}),
			}) as any;

		await harness.runSuite(loopFactory);
		expect(harness.getPassingTests().length).toBeGreaterThanOrEqual(1);
	});
});
