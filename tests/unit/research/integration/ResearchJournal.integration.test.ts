import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type {
	ExperimentRun,
	Hypothesis,
	RunMetrics,
	SkillEvaluation,
	StrategyPromotion,
	TransferRecord,
} from "../../../../src/core/research/types.js";

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

function makeRun(domain: string, variant: string, metrics?: Partial<RunMetrics>): ExperimentRun {
	return {
		id: `run_${domain}_${variant}`,
		experimentId: `exp_${domain}`,
		hypothesis: { id: `hyp_${variant}`, description: "test", variant, changeDescription: "none", parameters: {} },
		goal: "test goal",
		domain,
		result: {
			status: metrics?.goalAchieved === false ? "failed" : "completed",
			goal: { description: "test goal", maxIterations: 10 },
			totalIterations: metrics?.iterationsToGoal ?? 5,
			totalDurationMs: metrics?.totalDurationMs ?? 1000,
			totalCostUsd: metrics?.totalCostUsd ?? 0.01,
			createdSkills: [],
			stopReason: metrics?.goalAchieved === false ? "max-iterations" : "goal-achieved",
		},
		metrics: makeMetrics(metrics),
		timestamp: new Date().toISOString(),
	};
}

describe("ResearchJournal — Integration", () => {
	let journal: ResearchJournal;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "talox-journal-int-"));
		journal = new ResearchJournal({ persistPath: join(tmpDir, "journal.jsonl") });
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("persists entries to disk and reloads them faithfully", async () => {
		// Record diverse entry types
		journal.recordExperimentRun(makeRun("reddit.com", "control"));
		journal.recordExperimentRun(makeRun("x.com", "treatment_1", { iterationsToGoal: 3 }));
		journal.recordSkillEvaluation({
			skillName: "stealth-v1",
			domain: "reddit.com",
			beforeMetrics: makeMetrics({ iterationsToGoal: 10 }),
			afterMetrics: makeMetrics({ iterationsToGoal: 5 }),
			improvement: 0.5,
			verdict: "helped",
			timestamp: new Date().toISOString(),
		});
		journal.recordStrategyPromotion({
			strategyName: "aggressive_shift",
			domain: "x.com",
			winningParameters: { stealthLevel: 0.3 },
			evidence: ["run_1", "run_2"],
			promotedAt: new Date().toISOString(),
		});
		journal.recordTransfer({
			sourceDomain: "reddit.com",
			targetDomain: "x.com",
			strategyName: "stealth-v1",
			transferSuccess: true,
			improvementRatio: 1.3,
			timestamp: new Date().toISOString(),
		});

		expect(journal.size).toBe(5);

		// Flush to disk
		await journal.flush();

		// Load into a fresh journal
		const journal2 = new ResearchJournal({ persistPath: join(tmpDir, "journal.jsonl") });
		await journal2.load();

		expect(journal2.size).toBe(5);
		expect(journal2.getKnownDomains()).toContain("reddit.com");
		expect(journal2.getKnownDomains()).toContain("x.com");

		const redditSummary = journal2.getDomainSummary("reddit.com");
		expect(redditSummary).not.toBeNull();
		expect(redditSummary!.totalRuns).toBe(1);
		expect(redditSummary!.successRate).toBe(1);

		const xSummary = journal2.getDomainSummary("x.com");
		expect(xSummary!.totalRuns).toBe(1);
	});

	it("computes correct domain summaries across multiple runs", async () => {
		// 3 runs on reddit: 2 success, 1 fail
		journal.recordExperimentRun(makeRun("reddit.com", "control", { goalAchieved: true, iterationsToGoal: 5 }));
		journal.recordExperimentRun(makeRun("reddit.com", "treatment_1", { goalAchieved: true, iterationsToGoal: 3 }));
		journal.recordExperimentRun(makeRun("reddit.com", "treatment_2", { goalAchieved: false, iterationsToGoal: 10 }));

		const summary = journal.getDomainSummary("reddit.com");
		expect(summary!.totalRuns).toBe(3);
		expect(summary!.successRate).toBeCloseTo(2 / 3, 2);
		expect(summary!.avgIterationsToGoal).toBeCloseTo(6, 0);
	});

	it("filters entries by type correctly", () => {
		journal.recordExperimentRun(makeRun("a.com", "control"));
		journal.recordExperimentRun(makeRun("b.com", "control"));
		journal.recordSkillEvaluation({
			skillName: "s1",
			domain: "a.com",
			beforeMetrics: makeMetrics(),
			afterMetrics: makeMetrics(),
			improvement: 0,
			verdict: "neutral",
			timestamp: new Date().toISOString(),
		});

		expect(journal.getEntries("experiment_run")).toHaveLength(2);
		expect(journal.getEntries("skill_evaluated")).toHaveLength(1);
		expect(journal.getEntries("strategy_promoted")).toHaveLength(0);
	});

	it("returns empty results for unknown domains", () => {
		expect(journal.getDomainSummary("nonexistent.com")).toBeNull();
		expect(journal.getRecentRuns("nonexistent.com", 10)).toEqual([]);
	});

	it("handles incremental appends across flush cycles", async () => {
		journal.recordExperimentRun(makeRun("a.com", "control"));
		await journal.flush();

		const j2 = new ResearchJournal({ persistPath: join(tmpDir, "journal.jsonl") });
		await j2.load();
		expect(j2.size).toBe(1);

		j2.recordExperimentRun(makeRun("b.com", "control"));
		await j2.flush();

		const j3 = new ResearchJournal({ persistPath: join(tmpDir, "journal.jsonl") });
		await j3.load();
		expect(j3.size).toBe(2);
		expect(j3.getKnownDomains()).toContain("a.com");
		expect(j3.getKnownDomains()).toContain("b.com");
	});
});
