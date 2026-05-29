import { beforeEach, describe, expect, it, vi } from "vitest";
import { HypothesisGenerator } from "../../../src/core/research/HypothesisGenerator.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { ExperimentRun, RunMetrics } from "../../../src/core/research/types.js";

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
	return {
		iterationsToGoal: 5,
		totalDurationMs: 1000,
		totalCostUsd: 0.01,
		blockerCount: 0,
		blockerTypes: [],
		goalAchieved: true,
		skillsCreated: 0,
		strategySuccessRate: 1.0,
		...overrides,
	};
}

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
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
		metrics: makeMetrics(),
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

describe("HypothesisGenerator", () => {
	let journal: ResearchJournal;
	let gen: HypothesisGenerator;

	beforeEach(() => {
		journal = new ResearchJournal();
		gen = new HypothesisGenerator(journal);
	});

	it("generates control + N treatment hypotheses", async () => {
		const hypotheses = await gen.generate("example.com", "test goal", { stealthLevel: 0.5 }, 3);
		expect(hypotheses.length).toBeGreaterThanOrEqual(4); // 1 control + 3 treatment
		expect(hypotheses[0]!.variant).toBe("control");
		expect(hypotheses[0]!.description).toContain("Control");
	});

	it("control hypothesis has the same parameters as base", async () => {
		const base = { stealthLevel: 0.5, maxRetries: 3 };
		const hypotheses = await gen.generate("example.com", "goal", base, 2);
		expect(hypotheses[0]!.parameters).toEqual(base);
	});

	it("treatment hypotheses have modified parameters", async () => {
		const base = { stealthLevel: 0.5, maxRetries: 3 };
		const hypotheses = await gen.generate("example.com", "goal", base, 3);
		// At least one treatment should differ from base
		const treatments = hypotheses.slice(1);
		const anyDifferent = treatments.some((h) => JSON.stringify(h.parameters) !== JSON.stringify(base));
		expect(anyDifferent).toBe(true);
	});

	it("records all hypotheses in journal", async () => {
		await gen.generate("example.com", "goal", {}, 2);
		const hyps = journal.getEntries("hypothesis_generated");
		expect(hyps.length).toBeGreaterThanOrEqual(3);
	});

	it("generates LLM hypothesis when planner has generateSkill and history exists", async () => {
		// Add history to journal
		journal.recordExperimentRun(makeRun({ domain: "example.com" }));

		const mockPlanner = {
			generateSkill: vi.fn().mockResolvedValue({
				description: "novel approach",
				triggerCondition: "when blocked",
				content: "do X then Y",
			}),
		};
		const genWithPlanner = new HypothesisGenerator(journal, mockPlanner as any);
		const hypotheses = await genWithPlanner.generate("example.com", "goal", {}, 1);

		const llmHyp = hypotheses.find((h) => h.variant === "treatment_llm");
		expect(llmHyp).toBeDefined();
		expect(llmHyp!.description).toContain("LLM-generated");
	});

	it("handles planner failure gracefully", async () => {
		journal.recordExperimentRun(makeRun({ domain: "example.com" }));

		const mockPlanner = {
			generateSkill: vi.fn().mockRejectedValue(new Error("LLM down")),
		};
		const genWithPlanner = new HypothesisGenerator(journal, mockPlanner as any);
		const hypotheses = await genWithPlanner.generate("example.com", "goal", {}, 1);
		// Should still return control + treatments, no LLM hypothesis
		expect(hypotheses.length).toBeGreaterThanOrEqual(2);
		const llmHyp = hypotheses.find((h) => h.variant === "treatment_llm");
		expect(llmHyp).toBeUndefined();
	});

	it("each hypothesis has a unique id", async () => {
		const hypotheses = await gen.generate("example.com", "goal", {}, 3);
		const ids = hypotheses.map((h) => h.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
