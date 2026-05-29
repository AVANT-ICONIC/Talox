import { beforeEach, describe, expect, it } from "vitest";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import { SkillEvaluator } from "../../../src/core/research/SkillEvaluator.js";
import type { ExperimentRun, RunMetrics } from "../../../src/core/research/types.js";

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
	return {
		iterationsToGoal: 10,
		totalDurationMs: 5000,
		totalCostUsd: 0.05,
		blockerCount: 2,
		blockerTypes: ["captcha"],
		goalAchieved: true,
		skillsCreated: 0,
		strategySuccessRate: 0.8,
		...overrides,
	};
}

function makeRun(metrics: Partial<RunMetrics> = {}): ExperimentRun {
	return {
		id: "run_test",
		experimentId: "exp_test",
		hypothesis: { id: "hyp_test", description: "test", variant: "control", changeDescription: "none", parameters: {} },
		goal: "test goal",
		domain: "example.com",
		result: {
			status: "completed",
			goal: { description: "test goal", maxIterations: 10 },
			totalIterations: 5,
			totalDurationMs: 1000,
			totalCostUsd: 0.01,
			createdSkills: [],
			stopReason: "goal-achieved",
		},
		metrics: makeMetrics(metrics),
		timestamp: new Date().toISOString(),
	};
}

describe("SkillEvaluator", () => {
	let journal: ResearchJournal;
	let evaluator: SkillEvaluator;

	beforeEach(() => {
		journal = new ResearchJournal();
		evaluator = new SkillEvaluator(journal);
	});

	it("returns helped when after metrics are better", () => {
		const before = [makeRun({ iterationsToGoal: 20, totalDurationMs: 10000 })];
		const after = [makeRun({ iterationsToGoal: 5, totalDurationMs: 2000 })];

		const result = evaluator.evaluate("test-skill", "example.com", before, after);
		expect(result.verdict).toBe("helped");
		expect(result.improvement).toBeGreaterThan(0);
	});

	it("returns hurt when after metrics are worse", () => {
		const before = [makeRun({ iterationsToGoal: 5, totalDurationMs: 1000 })];
		const after = [makeRun({ iterationsToGoal: 30, totalDurationMs: 15000 })];

		const result = evaluator.evaluate("test-skill", "example.com", before, after);
		expect(result.verdict).toBe("hurt");
		expect(result.improvement).toBeLessThan(0);
	});

	it("returns neutral when metrics are similar", () => {
		const before = [makeRun({ iterationsToGoal: 10, totalDurationMs: 5000, goalAchieved: false })];
		const after = [makeRun({ iterationsToGoal: 10, totalDurationMs: 5200, goalAchieved: false })];

		const result = evaluator.evaluate("test-skill", "example.com", before, after);
		expect(result.verdict).toBe("neutral");
	});

	it("records evaluation in journal", () => {
		evaluator.evaluate("test-skill", "example.com", [makeRun()], [makeRun()]);
		expect(journal.getEntries("skill_evaluated")).toHaveLength(1);
	});

	it("includes timestamp in evaluation", () => {
		const result = evaluator.evaluate("test-skill", "example.com", [makeRun()], [makeRun()]);
		expect(result.timestamp).toBeTruthy();
	});

	it("shouldKeepSkill returns true for unknown skills", () => {
		expect(evaluator.shouldKeepSkill("unknown-skill")).toBe(true);
	});

	it("shouldKeepSkill returns false for consistently hurtful skills", () => {
		// Create 3 hurt evaluations
		for (let i = 0; i < 3; i++) {
			const before = [makeRun({ iterationsToGoal: 5 })];
			const after = [makeRun({ iterationsToGoal: 50 })];
			evaluator.evaluate("bad-skill", "example.com", before, after);
		}
		expect(evaluator.shouldKeepSkill("bad-skill")).toBe(false);
	});

	it("getBestSkillForDomain returns the best helped skill", () => {
		const before1 = [makeRun({ iterationsToGoal: 20 })];
		const after1 = [makeRun({ iterationsToGoal: 2 })];
		evaluator.evaluate("great-skill", "example.com", before1, after1);

		const before2 = [makeRun({ iterationsToGoal: 20 })];
		const after2 = [makeRun({ iterationsToGoal: 8 })];
		evaluator.evaluate("ok-skill", "example.com", before2, after2);

		expect(evaluator.getBestSkillForDomain("example.com")).toBe("great-skill");
	});

	it("getBestSkillForDomain returns null when no evaluations exist", () => {
		expect(evaluator.getBestSkillForDomain("unknown.com")).toBeNull();
	});

	it("aggregates multiple runs correctly", () => {
		const before = [makeRun({ iterationsToGoal: 10 }), makeRun({ iterationsToGoal: 20 })];
		const after = [makeRun({ iterationsToGoal: 2 }), makeRun({ iterationsToGoal: 3 })];

		const result = evaluator.evaluate("test-skill", "example.com", before, after);
		// Average before: 15, average after: 2.5 → big improvement
		expect(result.verdict).toBe("helped");
	});

	it("handles empty run arrays", () => {
		const result = evaluator.evaluate("test-skill", "example.com", [], []);
		expect(result).toBeDefined();
	});

	it("respects custom improvementThreshold", () => {
		const strictEvaluator = new SkillEvaluator(journal, { improvementThreshold: 0.5 });
		const before = [makeRun({ iterationsToGoal: 10 })];
		const after = [makeRun({ iterationsToGoal: 8 })]; // 25% improvement

		const result = strictEvaluator.evaluate("test-skill", "example.com", before, after);
		// 25% improvement < 50% threshold → neutral
		expect(result.verdict).toBe("neutral");
	});
});
