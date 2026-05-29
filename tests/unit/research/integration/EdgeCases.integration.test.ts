import { beforeEach, describe, expect, it } from "vitest";
import { AdaptiveExperimentPriority } from "../../../../src/core/research/AdaptiveExperimentPriority.js";
import { CrossDomainTransfer } from "../../../../src/core/research/CrossDomainTransfer.js";
import { HypothesisGenerator } from "../../../../src/core/research/HypothesisGenerator.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import { SkillEvaluator } from "../../../../src/core/research/SkillEvaluator.js";
import type { ExperimentRun, RunMetrics, SkillEvaluation } from "../../../../src/core/research/types.js";

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

function makeRun(domain: string, variant = "control", overrides: Partial<RunMetrics> = {}): ExperimentRun {
	return {
		id: `run_${Math.random().toString(36).slice(2, 8)}`,
		experimentId: "exp_1",
		hypothesis: { id: "h1", description: "test", variant, changeDescription: "", parameters: {} },
		goal: "test",
		domain,
		result: {
			status: overrides.goalAchieved === false ? "failed" : "completed",
			goal: { description: "test", maxIterations: 10 },
			totalIterations: overrides.iterationsToGoal ?? 5,
			totalDurationMs: overrides.totalDurationMs ?? 1000,
			totalCostUsd: overrides.totalCostUsd ?? 0.01,
			createdSkills: [],
			stopReason: "goal-achieved",
		},
		metrics: makeMetrics(overrides),
		timestamp: new Date().toISOString(),
	};
}

describe("Edge Cases — Integration", () => {
	describe("ResearchJournal edge cases", () => {
		it("handles empty journal gracefully", () => {
			const j = new ResearchJournal({});
			expect(j.size).toBe(0);
			expect(j.getEntries("experiment_run")).toEqual([]);
			expect(j.getRecentRuns("any.com", 10)).toEqual([]);
			expect(j.getDomainSummary("unknown.com")).toBeNull();
			expect(j.toSnapshot().entries).toEqual([]);
		});

		it("handles search with no matches", () => {
			const j = new ResearchJournal({});
			j.recordExperimentRun(makeRun("a.com"));
			expect(j.getEntries("skill_evaluated")).toEqual([]);
			expect(j.getRecentRuns("other.com", 10)).toEqual([]);
		});

		it("handles zero metrics correctly", () => {
			const j = new ResearchJournal({});
			j.recordExperimentRun(
				makeRun("zero.com", "control", {
					iterationsToGoal: 0,
					totalDurationMs: 0,
					totalCostUsd: 0,
					blockerCount: 0,
					goalAchieved: false,
					skillsCreated: 0,
					strategySuccessRate: 0,
				}),
			);
			expect(j.size).toBe(1);
			const run = j.getRecentRuns("zero.com", 1)[0]!;
			expect(run.metrics.iterationsToGoal).toBe(0);
		});
	});

	describe("SkillEvaluator edge cases", () => {
		it("returns helped when after metrics improve over before", () => {
			const j = new ResearchJournal({});
			const eval_ = new SkillEvaluator(j);

			const before = [makeRun("t.com", "control", { iterationsToGoal: 10 })];
			const after = [makeRun("t.com", "control", { iterationsToGoal: 3 })];

			const result = eval_.evaluate("skill-1", "t.com", before, after);
			expect(result.verdict).toBe("helped");
			expect(result.improvement).toBeGreaterThan(0);
		});

		it("handles empty run arrays (zero metrics)", () => {
			const j = new ResearchJournal({});
			const eval_ = new SkillEvaluator(j);

			const result = eval_.evaluate("skill-2", "t.com", [], []);
			expect(result.verdict).toBe("neutral");
		});

		it("shouldKeepSkill returns true when no evaluations exist", () => {
			const j = new ResearchJournal({});
			const eval_ = new SkillEvaluator(j);
			expect(eval_.shouldKeepSkill("unknown-skill")).toBe(true);
		});

		it("prunes skill after 2 hurt evaluations", () => {
			const j = new ResearchJournal({});
			const eval_ = new SkillEvaluator(j);

			// Record 2 hurt evaluations
			for (let i = 0; i < 2; i++) {
				eval_.evaluate(
					"bad-skill",
					"t.com",
					[makeRun("t.com", "control", { iterationsToGoal: 3 })],
					[makeRun("t.com", "control", { iterationsToGoal: 20 })],
				);
			}

			expect(eval_.shouldKeepSkill("bad-skill")).toBe(false);
		});

		it("getBestSkillForDomain returns null when nothing helped", () => {
			const j = new ResearchJournal({});
			const eval_ = new SkillEvaluator(j);
			expect(eval_.getBestSkillForDomain("nope.com")).toBeNull();
		});
	});

	describe("AdaptiveExperimentPriority edge cases", () => {
		it("handles single arm correctly", () => {
			const j = new ResearchJournal({});
			const p = new AdaptiveExperimentPriority(j, { seed: 123 });

			p.registerArm("solo");
			for (let i = 0; i < 5; i++) p.recordOutcome("solo", true);

			expect(p.selectNext()).toBe("solo");
			expect(p.getBestArm()!.name).toBe("solo");
		});

		it("handles all-failure arm", () => {
			const j = new ResearchJournal({});
			const p = new AdaptiveExperimentPriority(j, { seed: 456 });

			p.registerArm("always-fail");
			for (let i = 0; i < 20; i++) p.recordOutcome("always-fail", false);

			const stats = p.getArmStats("always-fail")!;
			expect(stats.estimatedValue).toBeLessThan(0.1);
		});
	});

	describe("HypothesisGenerator edge cases", () => {
		it("generates hypotheses even with empty journal", async () => {
			const j = new ResearchJournal({});
			const gen = new HypothesisGenerator(j);

			const hypotheses = await gen.generate("test.com", "test goal", { stealthLevel: 0.5 }, 3);
			// 1 control + 3 treatments
			expect(hypotheses.length).toBeGreaterThanOrEqual(4);
			expect(hypotheses[0]!.variant).toBe("control");
		});

		it("generates correct count of treatment variants", async () => {
			const j = new ResearchJournal({});
			const gen = new HypothesisGenerator(j);

			const hypotheses = await gen.generate("test.com", "test", {}, 2);
			const treatments = hypotheses.filter((h) => h.variant !== "control");
			expect(treatments.length).toBe(2);
		});
	});

	describe("CrossDomainTransfer edge cases", () => {
		it("records transfer with improvement ratio > 1.0 as success", () => {
			const j = new ResearchJournal({});
			j.recordExperimentRun(makeRun("a.com"));
			j.recordExperimentRun(makeRun("b.com"));

			const t = new CrossDomainTransfer(j);
			const record = t.recordTransfer("a.com", "b.com", "strat", 1.5);
			expect(record.transferSuccess).toBe(true);
			expect(record.improvementRatio).toBe(1.5);
		});
	});

	describe("Large data handling", () => {
		it("journal handles 1000 entries without issues", () => {
			const j = new ResearchJournal({});

			for (let i = 0; i < 1000; i++) {
				j.recordExperimentRun(makeRun(`domain-${i % 10}.com`, `variant-${i % 5}`));
			}

			expect(j.size).toBe(1000);
			expect(j.getRecentRuns("domain-0.com", 10).length).toBeLessThanOrEqual(10);
			expect(j.getEntries("experiment_run").length).toBe(1000);

			const snapshot = j.toSnapshot();
			expect(snapshot.entries.length).toBe(1000);
		});

		it("AdaptiveExperimentPriority handles many arms", () => {
			const j = new ResearchJournal({});
			const p = new AdaptiveExperimentPriority(j, { seed: 789 });

			for (let i = 0; i < 50; i++) {
				p.registerArm(`arm-${i}`);
				p.recordOutcome(`arm-${i}`, Math.random() > 0.5);
			}

			expect(p.armCount).toBe(50);
			expect(p.selectNext()).toBeTruthy();
			expect(p.getRankedArms().length).toBe(50);
		});
	});
});
