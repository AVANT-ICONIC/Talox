import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExperimentRunner } from "../../../../src/core/research/ExperimentRunner.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { AutoResearchConfig, Hypothesis, ExperimentRun, RunMetrics } from "../../../../src/core/research/types.js";
import type { LoopResult } from "../../../../src/core/research/../loop/types.js";

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
	return {
		iterationsToGoal: 5, totalDurationMs: 1000, totalCostUsd: 0.01,
		blockerCount: 0, blockerTypes: [], goalAchieved: true,
		skillsCreated: 0, strategySuccessRate: 1.0, ...overrides,
	};
}

function makeResult(overrides: Partial<LoopResult> = {}): LoopResult {
	return {
		status: "completed",
		goal: { description: "test", maxIterations: 10 },
		totalIterations: 5, totalDurationMs: 1000, totalCostUsd: 0.01,
		createdSkills: [], stopReason: "goal-achieved", ...overrides,
	};
}

const defaultConfig: AutoResearchConfig = {
	runsPerVariant: 3, promotionThreshold: 0.15, excludedDomains: [],
	persistToDisk: false, researchDir: ".talox/research",
	maxConcurrentExperiments: 1, enableCrossDomainTransfer: true,
	enablePromptEvolution: false, maxSkillVersions: 5,
	regressionTimeoutMs: 60_000, adaptivePriority: true,
	compositionConfidenceThreshold: 0.7,
};

describe("ExperimentRunner — Integration", () => {
	let journal: ResearchJournal;
	let runner: ExperimentRunner;

	beforeEach(() => {
		journal = new ResearchJournal({});
		runner = new ExperimentRunner(journal, defaultConfig);
	});

	it("runs A/B experiment with 2 hypotheses and compares results", async () => {
		const controlHyp: Hypothesis = {
			id: "hyp_ctrl", description: "control", variant: "control",
			changeDescription: "none", parameters: { stealthLevel: 0.5 },
		};
		const treatmentHyp: Hypothesis = {
			id: "hyp_treat", description: "treatment", variant: "treatment_fast",
			changeDescription: "lower stealth", parameters: { stealthLevel: 0.2 },
		};

		// Mock loop factory: control is slow, treatment is fast
		const loopFactory = vi.fn(async (params: Record<string, unknown>) => {
			const isControl = params.stealthLevel === 0.5;
			return {
				run: vi.fn(async () => makeResult(isControl
					? { totalIterations: 10, totalDurationMs: 5000, totalCostUsd: 0.05 }
					: { totalIterations: 3, totalDurationMs: 500, totalCostUsd: 0.005 }
				)),
			} as any;
		});

		const comparison = await runner.runExperiment(
			[controlHyp, treatmentHyp],
			{ description: "test A/B", maxIterations: 20 },
			"reddit.com",
			loopFactory,
		);

		expect(comparison).not.toBeNull();
		expect(comparison!.winner).toBe("treatment");
		expect(comparison!.deltas.iterationRatio).toBeGreaterThan(1);
		expect(comparison!.confidence).toBeGreaterThan(0);

		// Journal should have both runs recorded
		expect(journal.size).toBe(2);
	});

	it("returns null when only 1 hypothesis provided", async () => {
		const single: Hypothesis = {
			id: "hyp_1", description: "only", variant: "control",
			changeDescription: "none", parameters: {},
		};
		const result = await runner.runExperiment(
			[single],
			{ description: "single", maxIterations: 10 },
			"test.com",
			vi.fn(),
		);
		expect(result).toBeNull();
	});

	it("skips excluded domains", async () => {
		const config: AutoResearchConfig = { ...defaultConfig, excludedDomains: ["bad.com"] };
		const excludedRunner = new ExperimentRunner(journal, config);

		const hypA: Hypothesis = { id: "a", description: "a", variant: "control", changeDescription: "", parameters: {} };
		const hypB: Hypothesis = { id: "b", description: "b", variant: "treatment", changeDescription: "", parameters: {} };

		const result = await excludedRunner.runExperiment(
			[hypA, hypB],
			{ description: "test", maxIterations: 10 },
			"bad.com",
			vi.fn(),
		);
		expect(result).toBeNull();
	});

	it("compare() produces correct deltas", () => {
		const control: ExperimentRun = {
			id: "ctrl", experimentId: "exp1", domain: "x.com",
			goal: "test", timestamp: new Date().toISOString(),
			hypothesis: { id: "h1", description: "", variant: "control", changeDescription: "", parameters: {} },
			result: makeResult(),
			metrics: makeMetrics({ iterationsToGoal: 10, totalDurationMs: 2000, totalCostUsd: 0.02, blockerCount: 2 }),
		};
		const treatment: ExperimentRun = {
			id: "treat", experimentId: "exp1", domain: "x.com",
			goal: "test", timestamp: new Date().toISOString(),
			hypothesis: { id: "h2", description: "", variant: "treatment", changeDescription: "", parameters: {} },
			result: makeResult({ totalIterations: 5 }),
			metrics: makeMetrics({ iterationsToGoal: 5, totalDurationMs: 1000, totalCostUsd: 0.01, blockerCount: 0 }),
		};

		const comp = runner.compare(control, treatment);
		expect(comp.deltas.iterationRatio).toBe(2);  // 10/5
		expect(comp.deltas.durationRatio).toBe(2);    // 2000/1000
		expect(comp.winner).toBe("treatment");
	});

	it("runSingleArm records a single run to journal", async () => {
		const hyp: Hypothesis = {
			id: "hyp_s", description: "single", variant: "control",
			changeDescription: "", parameters: {},
		};

		const loopFactory = vi.fn(async () => ({
			run: vi.fn(async () => makeResult()),
		}) as any);

		const run = await runner.runSingleArm(
			hyp, { description: "test", maxIterations: 10 }, "test.com", loopFactory,
		);

		expect(run).not.toBeNull();
		expect(run!.hypothesis.variant).toBe("control");
		expect(journal.size).toBe(1);
	});
});
