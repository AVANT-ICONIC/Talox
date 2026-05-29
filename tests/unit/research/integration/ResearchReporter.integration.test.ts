import { beforeEach, describe, expect, it } from "vitest";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import { ResearchReporter } from "../../../../src/core/research/ResearchReporter.js";
import type {
	ExperimentRun,
	RunMetrics,
	SkillEvaluation,
	StrategyPromotion,
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

function makeRun(domain: string, goalAchieved: boolean): ExperimentRun {
	return {
		id: `run_${domain}_${Date.now()}`,
		experimentId: `exp_${domain}`,
		hypothesis: { id: "h1", description: "test", variant: "control", changeDescription: "", parameters: {} },
		goal: "test",
		domain,
		result: {
			status: goalAchieved ? "completed" : "failed",
			goal: { description: "test", maxIterations: 10 },
			totalIterations: 5,
			totalDurationMs: 1000,
			totalCostUsd: 0.01,
			createdSkills: [],
			stopReason: goalAchieved ? "goal-achieved" : "max-iterations",
		},
		metrics: makeMetrics({ goalAchieved }),
		timestamp: new Date().toISOString(),
	};
}

describe("ResearchReporter — Integration", () => {
	let journal: ResearchJournal;
	let reporter: ResearchReporter;

	beforeEach(() => {
		journal = new ResearchJournal({});
		reporter = new ResearchReporter(journal);
	});

	it("generates report with correct statistics", () => {
		journal.recordExperimentRun(makeRun("reddit.com", true));
		journal.recordExperimentRun(makeRun("reddit.com", true));
		journal.recordExperimentRun(makeRun("x.com", false));

		const promo: StrategyPromotion = {
			strategyName: "fast-stealth",
			domain: "reddit.com",
			winningParameters: {},
			evidence: ["e1", "e2"],
			promotedAt: new Date().toISOString(),
		};
		journal.recordStrategyPromotion(promo);

		const now = new Date();
		const from = new Date(now.getTime() - 86_400_000).toISOString();
		const to = now.toISOString();

		const report = reporter.generateReport({ from, to });

		expect(report.id).toBeTruthy();
		expect(report.experimentsConducted).toBe(3);
		expect(report.strategiesPromoted).toBe(1);
		expect(report.summary).toContain("3 experiments");
		expect(report.summary).toContain("67%"); // 2/3 success
	});

	it("includes domain summaries", () => {
		journal.recordExperimentRun(makeRun("reddit.com", true));
		journal.recordExperimentRun(makeRun("reddit.com", false));
		journal.recordExperimentRun(makeRun("x.com", true));

		const now = new Date();
		const report = reporter.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		const domains = Object.keys(report.domainSummaries);
		expect(domains).toContain("reddit.com");
		expect(domains).toContain("x.com");
		expect(report.domainSummaries["reddit.com"]!.totalRuns).toBe(2);
		expect(report.domainSummaries["x.com"]!.totalRuns).toBe(1);
	});

	it("extracts findings from promotions and evaluations", () => {
		journal.recordExperimentRun(makeRun("test.com", true));

		const promo: StrategyPromotion = {
			strategyName: "super-strat",
			domain: "test.com",
			winningParameters: {},
			evidence: ["e1", "e2", "e3"],
			promotedAt: new Date().toISOString(),
		};
		journal.recordStrategyPromotion(promo);

		const eval_: SkillEvaluation = {
			skillName: "auto-captcha",
			domain: "test.com",
			beforeMetrics: makeMetrics({ iterationsToGoal: 10 }),
			afterMetrics: makeMetrics({ iterationsToGoal: 3 }),
			improvement: 0.7,
			verdict: "helped",
			timestamp: new Date().toISOString(),
		};
		journal.recordSkillEvaluation(eval_);

		const now = new Date();
		const report = reporter.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		expect(report.topFindings.length).toBeGreaterThan(0);
		const promoFinding = report.topFindings.find((f) => f.description.includes("super-strat"));
		expect(promoFinding).toBeTruthy();
		expect(promoFinding!.impact).toBe("high");

		const skillFinding = report.topFindings.find((f) => f.description.includes("auto-captcha"));
		expect(skillFinding).toBeTruthy();
	});

	it("flags domains with low success rates", () => {
		// 5 runs, only 1 success → 20% success rate
		for (let i = 0; i < 5; i++) {
			journal.recordExperimentRun(makeRun("bad.com", i === 0));
		}

		const now = new Date();
		const report = reporter.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		const lowRateFinding = report.topFindings.find((f) => f.description.includes("bad.com"));
		expect(lowRateFinding).toBeTruthy();
		expect(lowRateFinding!.description).toContain("20%");
	});

	it("renderMarkdown produces valid markdown", () => {
		journal.recordExperimentRun(makeRun("md.com", true));

		const now = new Date();
		const report = reporter.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		const md = reporter.renderMarkdown(report);
		expect(md).toContain("# ");
		expect(md).toContain("## Summary");
		expect(md).toContain("## Statistics");
		expect(md).toContain("1 experiments");
	});

	it("renderJSON produces valid JSON", () => {
		journal.recordExperimentRun(makeRun("json.com", true));

		const now = new Date();
		const report = reporter.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		const json = reporter.renderJSON(report);
		const parsed = JSON.parse(json);
		expect(parsed.id).toBe(report.id);
		expect(parsed.experimentsConducted).toBe(1);
	});

	it("generates empty report for period with no data", () => {
		const report = reporter.generateReport({
			from: "2020-01-01",
			to: "2020-01-02",
		});

		expect(report.experimentsConducted).toBe(0);
		expect(report.strategiesPromoted).toBe(0);
		expect(report.topFindings).toEqual([]);
	});
});
