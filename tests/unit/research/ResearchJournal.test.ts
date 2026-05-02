import { describe, it, expect, beforeEach } from "vitest";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { ExperimentRun, Hypothesis, RunMetrics } from "../../../src/core/research/types.js";

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
		hypothesis: {
			id: "hyp_test",
			description: "test",
			variant: "control",
			changeDescription: "none",
			parameters: {},
		},
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

describe("ResearchJournal", () => {
	let journal: ResearchJournal;

	beforeEach(() => {
		journal = new ResearchJournal();
	});

	it("starts empty", () => {
		expect(journal.size).toBe(0);
		expect(journal.getEntries()).toEqual([]);
	});

	it("records experiment runs", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		expect(journal.size).toBe(1);
		const entries = journal.getEntries("experiment_run");
		expect(entries).toHaveLength(1);
		expect((entries[0]!.data as ExperimentRun).domain).toBe("a.com");
	});

	it("records skill evaluations", () => {
		journal.recordSkillEvaluation({
			skillName: "test-skill",
			domain: "a.com",
			beforeMetrics: makeMetrics(),
			afterMetrics: makeMetrics(),
			improvement: 0.2,
			verdict: "helped",
			timestamp: new Date().toISOString(),
		});
		expect(journal.getEntries("skill_evaluated")).toHaveLength(1);
	});

	it("records strategy promotions", () => {
		journal.recordStrategyPromotion({
			strategyName: "stealth-v2",
			domain: "a.com",
			winningParameters: { stealthLevel: 0.9 },
			evidence: ["run1"],
			promotedAt: new Date().toISOString(),
		});
		const entries = journal.getEntries("strategy_promoted");
		expect(entries).toHaveLength(1);
	});

	it("records hypotheses", () => {
		const hyp: Hypothesis = {
			id: "hyp_1",
			description: "test",
			variant: "control",
			changeDescription: "none",
			parameters: {},
		};
		journal.recordHypothesis(hyp);
		expect(journal.getEntries("hypothesis_generated")).toHaveLength(1);
	});

	it("records skill created events", () => {
		journal.recordSkillCreated(makeRun());
		expect(journal.getEntries("skill_created")).toHaveLength(1);
	});

	it("records transfer records", () => {
		journal.recordTransfer({
			sourceDomain: "a.com",
			targetDomain: "b.com",
			strategyName: "stealth-v2",
			transferSuccess: true,
			improvementRatio: 1.3,
			timestamp: new Date().toISOString(),
		});
		expect(journal.getEntries("cross_domain_transfer")).toHaveLength(1);
	});

	it("records compositions", () => {
		journal.recordComposition({
			id: "comp_1",
			name: "A + B",
			componentStrategies: ["A", "B"],
			applicationOrder: "parallel",
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		});
		expect(journal.getEntries("strategy_composed")).toHaveLength(1);
	});

	it("filters entries by type", () => {
		journal.recordExperimentRun(makeRun());
		journal.recordHypothesis({ id: "h1", description: "", variant: "control", changeDescription: "", parameters: {} });
		expect(journal.getEntries("experiment_run")).toHaveLength(1);
		expect(journal.getEntries("hypothesis_generated")).toHaveLength(1);
		expect(journal.getEntries()).toHaveLength(2);
	});

	it("computes domain summaries from experiment runs", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com", metrics: makeMetrics({ goalAchieved: true }) }));
		journal.recordExperimentRun(makeRun({ domain: "a.com", metrics: makeMetrics({ goalAchieved: false }) }));

		const summary = journal.getDomainSummary("a.com");
		expect(summary).not.toBeNull();
		expect(summary!.totalRuns).toBe(2);
		expect(summary!.successRate).toBe(0.5);
		expect(summary!.avgIterationsToGoal).toBe(5);
	});

	it("updates best strategy on promotion", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		journal.recordStrategyPromotion({
			strategyName: "best-strat",
			domain: "a.com",
			winningParameters: {},
			evidence: [],
			promotedAt: new Date().toISOString(),
		});
		expect(journal.getDomainSummary("a.com")!.bestStrategy).toBe("best-strat");
	});

	it("returns recent runs for a domain", () => {
		for (let i = 0; i < 5; i++) {
			journal.recordExperimentRun(makeRun({ domain: "a.com", id: `run_${i}` }));
		}
		const recent = journal.getRecentRuns("a.com", 3);
		expect(recent).toHaveLength(3);
	});

	it("returns runs by experiment ID", () => {
		journal.recordExperimentRun(makeRun({ experimentId: "exp_42" }));
		journal.recordExperimentRun(makeRun({ experimentId: "exp_99" }));
		journal.recordExperimentRun(makeRun({ experimentId: "exp_42" }));
		expect(journal.getExperimentRuns("exp_42")).toHaveLength(2);
	});

	it("returns known domains", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		journal.recordExperimentRun(makeRun({ domain: "b.com" }));
		expect(journal.getKnownDomains()).toEqual(expect.arrayContaining(["a.com", "b.com"]));
	});

	it("exports snapshot", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		const snap = journal.toSnapshot();
		expect(snap.version).toBe(1);
		expect(snap.entries).toHaveLength(1);
		expect(snap.domains).toHaveProperty("a.com");
	});

	describe("persistence", () => {
		it("flushes to disk and loads back", async () => {
			const path = `/tmp/talox-test-journal-${Date.now()}.jsonl`;
			const j1 = new ResearchJournal({ persistPath: path });
			j1.recordExperimentRun(makeRun({ domain: "a.com" }));
			await j1.flush();

			const j2 = new ResearchJournal({ persistPath: path });
			await j2.load();
			expect(j2.size).toBe(1);
			expect(j2.getKnownDomains()).toContain("a.com");
		});

		it("handles missing file gracefully on load", async () => {
			const j = new ResearchJournal({ persistPath: "/tmp/talox-nonexistent-12345.jsonl" });
			await j.load();
			expect(j.size).toBe(0);
		});
	});
});
