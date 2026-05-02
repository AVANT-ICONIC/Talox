import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExperimentRunner } from "../../../src/core/research/ExperimentRunner.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { AutoResearchConfig, Hypothesis, ExperimentRun } from "../../../src/core/research/types.js";
import type { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { LoopResult } from "../../../src/core/loop/types.js";

const defaultConfig: AutoResearchConfig = {
	runsPerVariant: 3,
	promotionThreshold: 0.15,
	excludedDomains: [],
	persistToDisk: false,
	researchDir: "/tmp/talox-test-research",
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
		goal: { description: "test goal", maxIterations: 10 },
		totalIterations: 5,
		totalDurationMs: 1000,
		totalCostUsd: 0.01,
		createdSkills: [],
		stopReason: "goal-achieved",
		...overrides,
	};
}

function makeHypothesis(variant: string, params: Record<string, unknown> = {}): Hypothesis {
	return {
		id: `hyp_${variant}`,
		description: `test ${variant}`,
		variant,
		changeDescription: "test",
		parameters: params,
	};
}

describe("ExperimentRunner", () => {
	let journal: ResearchJournal;
	let runner: ExperimentRunner;

	beforeEach(() => {
		journal = new ResearchJournal();
		runner = new ExperimentRunner(journal, defaultConfig);
	});

	it("returns null when fewer than 2 hypotheses", async () => {
		const mockFactory = vi.fn();
		const result = await runner.runExperiment([makeHypothesis("control")], { description: "goal", maxIterations: 10 }, "example.com", mockFactory);
		expect(result).toBeNull();
	});

	it("runs all hypothesis arms and returns comparison", async () => {
		const mockLoop = { run: vi.fn().mockResolvedValue(makeLoopResult()) } as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const result = await runner.runExperiment(
			[makeHypothesis("control"), makeHypothesis("treatment_1")],
			{ description: "goal", maxIterations: 10 },
			"example.com",
			factory,
		);

		expect(result).not.toBeNull();
		expect(factory).toHaveBeenCalledTimes(2);
	});

	it("records experiment runs in journal", async () => {
		const mockLoop = { run: vi.fn().mockResolvedValue(makeLoopResult()) } as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		await runner.runExperiment(
			[makeHypothesis("control"), makeHypothesis("treatment_1")],
			{ description: "goal", maxIterations: 10 },
			"example.com",
			factory,
		);

		expect(journal.getEntries("experiment_run")).toHaveLength(2);
	});

	it("skips excluded domains", async () => {
		const configWithExcluded = { ...defaultConfig, excludedDomains: ["blocked.com"] };
		const excludedRunner = new ExperimentRunner(journal, configWithExcluded);
		const factory = vi.fn();

		const result = await excludedRunner.runExperiment(
			[makeHypothesis("control"), makeHypothesis("treatment_1")],
			{ description: "goal", maxIterations: 10 },
			"blocked.com",
			factory,
		);

		expect(result).toBeNull();
		expect(factory).not.toHaveBeenCalled();
	});

	it("compare returns correct winner for better treatment", () => {
		const control: ExperimentRun = {
			id: "run_c",
			experimentId: "exp_1",
			hypothesis: makeHypothesis("control"),
			goal: "goal",
			domain: "example.com",
			result: makeLoopResult({ status: "failed", totalIterations: 20 }),
			metrics: {
				iterationsToGoal: 20,
				totalDurationMs: 10000,
				totalCostUsd: 0.1,
				blockerCount: 5,
				blockerTypes: [],
				goalAchieved: false,
				skillsCreated: 0,
				strategySuccessRate: 0.3,
			},
			timestamp: new Date().toISOString(),
		};

		const treatment: ExperimentRun = {
			id: "run_t",
			experimentId: "exp_1",
			hypothesis: makeHypothesis("treatment"),
			goal: "goal",
			domain: "example.com",
			result: makeLoopResult({ totalIterations: 3 }),
			metrics: {
				iterationsToGoal: 3,
				totalDurationMs: 500,
				totalCostUsd: 0.01,
				blockerCount: 0,
				blockerTypes: [],
				goalAchieved: true,
				skillsCreated: 0,
				strategySuccessRate: 1.0,
			},
			timestamp: new Date().toISOString(),
		};

		const comparison = runner.compare(control, treatment);
		expect(comparison.winner).toBe("treatment");
		expect(comparison.confidence).toBeGreaterThan(0);
	});

	it("compare returns control when treatment is worse", () => {
		const control: ExperimentRun = {
			id: "run_c",
			experimentId: "exp_1",
			hypothesis: makeHypothesis("control"),
			goal: "goal",
			domain: "example.com",
			result: makeLoopResult({ totalIterations: 3 }),
			metrics: {
				iterationsToGoal: 3,
				totalDurationMs: 500,
				totalCostUsd: 0.01,
				blockerCount: 0,
				blockerTypes: [],
				goalAchieved: true,
				skillsCreated: 0,
				strategySuccessRate: 1.0,
			},
			timestamp: new Date().toISOString(),
		};

		const treatment: ExperimentRun = {
			id: "run_t",
			experimentId: "exp_1",
			hypothesis: makeHypothesis("treatment"),
			goal: "goal",
			domain: "example.com",
			result: makeLoopResult({ status: "failed", totalIterations: 20 }),
			metrics: {
				iterationsToGoal: 20,
				totalDurationMs: 10000,
				totalCostUsd: 0.1,
				blockerCount: 5,
				blockerTypes: [],
				goalAchieved: false,
				skillsCreated: 0,
				strategySuccessRate: 0.3,
			},
			timestamp: new Date().toISOString(),
		};

		const comparison = runner.compare(control, treatment);
		expect(comparison.winner).toBe("control");
	});

	it("runSingleArm returns null for excluded domain", async () => {
		const configWithExcluded = { ...defaultConfig, excludedDomains: ["blocked.com"] };
		const excludedRunner = new ExperimentRunner(journal, configWithExcluded);
		const factory = vi.fn();

		const result = await excludedRunner.runSingleArm(
			makeHypothesis("control"),
			{ description: "goal", maxIterations: 10 },
			"blocked.com",
			factory,
		);

		expect(result).toBeNull();
	});

	it("runSingleArm returns experiment run on success", async () => {
		const mockLoop = { run: vi.fn().mockResolvedValue(makeLoopResult()) } as unknown as AutonomousLoop;
		const factory = vi.fn().mockResolvedValue(mockLoop);

		const result = await runner.runSingleArm(
			makeHypothesis("control"),
			{ description: "goal", maxIterations: 10 },
			"example.com",
			factory,
		);

		expect(result).not.toBeNull();
		expect(result!.hypothesis.variant).toBe("control");
	});

	it("runSingleArm returns null on loop failure", async () => {
		const factory = vi.fn().mockRejectedValue(new Error("loop crashed"));

		const result = await runner.runSingleArm(
			makeHypothesis("control"),
			{ description: "goal", maxIterations: 10 },
			"example.com",
			factory,
		);

		expect(result).toBeNull();
	});
});
