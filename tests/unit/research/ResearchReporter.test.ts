import { describe, it, expect, beforeEach } from "vitest";
import { ResearchReporter } from "../../../src/core/research/ResearchReporter.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { ExperimentRun, RunMetrics, SkillEvaluation, StrategyPromotion } from "../../../src/core/research/types.js";

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
		timestamp: "2026-05-01T10:00:00.000Z",
		...overrides,
	};
}

describe("ResearchReporter", () => {
	let journal: ResearchJournal;
	let reporter: ResearchReporter;

	beforeEach(() => {
		journal = new ResearchJournal();
		reporter = new ResearchReporter(journal);
	});

	const period = { from: "2026-01-01", to: "2026-12-31" };

	it("generates empty report when no data", () => {
		const report = reporter.generateReport(period);
		expect(report.experimentsConducted).toBe(0);
		expect(report.strategiesPromoted).toBe(0);
		expect(report.skillsEvaluated).toBe(0);
		expect(report.topFindings).toEqual([]);
	});

	it("counts experiments in period", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		journal.recordExperimentRun(makeRun({ domain: "b.com" }));

		const report = reporter.generateReport(period);
		expect(report.experimentsConducted).toBe(2);
	});

	it("excludes experiments outside period", () => {
		journal.recordExperimentRun(makeRun({ timestamp: "2025-01-01T10:00:00.000Z" }));
		const report = reporter.generateReport(period);
		expect(report.experimentsConducted).toBe(0);
	});

	it("counts strategy promotions", () => {
		journal.recordStrategyPromotion({
			strategyName: "s1",
			domain: "a.com",
			winningParameters: {},
			evidence: [],
			promotedAt: "2026-05-01T10:00:00.000Z",
		});
		const report = reporter.generateReport(period);
		expect(report.strategiesPromoted).toBe(1);
	});

	it("counts skill evaluations", () => {
		journal.recordSkillEvaluation({
			skillName: "skill1",
			domain: "a.com",
			beforeMetrics: makeMetrics(),
			afterMetrics: makeMetrics(),
			improvement: 0.2,
			verdict: "helped",
			timestamp: "2026-05-01T10:00:00.000Z",
		});
		const report = reporter.generateReport(period);
		expect(report.skillsEvaluated).toBe(1);
	});

	it("extracts findings from promotions", () => {
		journal.recordStrategyPromotion({
			strategyName: "stealth-v2",
			domain: "a.com",
			winningParameters: { stealth: 0.9 },
			evidence: ["r1", "r2", "r3"],
			promotedAt: "2026-05-01T10:00:00.000Z",
		});
		const report = reporter.generateReport(period);
		expect(report.topFindings.length).toBeGreaterThan(0);
		expect(report.topFindings[0]!.description).toContain("stealth-v2");
	});

	it("extracts findings from helped skills", () => {
		journal.recordSkillEvaluation({
			skillName: "good-skill",
			domain: "a.com",
			beforeMetrics: makeMetrics(),
			afterMetrics: makeMetrics(),
			improvement: 0.5,
			verdict: "helped",
			timestamp: "2026-05-01T10:00:00.000Z",
		});
		const report = reporter.generateReport(period);
		const finding = report.topFindings.find((f) => f.description.includes("good-skill"));
		expect(finding).toBeDefined();
		expect(finding!.impact).toBe("high");
	});

	it("extracts findings from hurt skills", () => {
		journal.recordSkillEvaluation({
			skillName: "bad-skill",
			domain: "a.com",
			beforeMetrics: makeMetrics(),
			afterMetrics: makeMetrics(),
			improvement: -0.4,
			verdict: "hurt",
			timestamp: "2026-05-01T10:00:00.000Z",
		});
		const report = reporter.generateReport(period);
		const finding = report.topFindings.find((f) => f.description.includes("bad-skill"));
		expect(finding).toBeDefined();
		expect(finding!.impact).toBe("high");
	});

	it("builds domain summaries", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com", metrics: makeMetrics({ goalAchieved: true }) }));
		journal.recordExperimentRun(makeRun({ domain: "a.com", metrics: makeMetrics({ goalAchieved: false }) }));

		const report = reporter.generateReport(period);
		expect(report.domainSummaries["a.com"]).toBeDefined();
		expect(report.domainSummaries["a.com"]!.totalRuns).toBe(2);
		expect(report.domainSummaries["a.com"]!.successRate).toBe(0.5);
	});

	it("renderMarkdown produces valid markdown", () => {
		journal.recordExperimentRun(makeRun({ domain: "a.com" }));
		const report = reporter.generateReport(period, "Test Report");
		const md = reporter.renderMarkdown(report);

		expect(md).toContain("# Test Report");
		expect(md).toContain("## Summary");
		expect(md).toContain("## Statistics");
		expect(md).toContain("Experiments conducted");
	});

	it("renderJSON produces valid JSON", () => {
		journal.recordExperimentRun(makeRun());
		const report = reporter.generateReport(period);
		const json = reporter.renderJSON(report);
		const parsed = JSON.parse(json);
		expect(parsed.id).toBe(report.id);
	});

	it("report has generatedAt timestamp", () => {
		const report = reporter.generateReport(period);
		expect(report.generatedAt).toBeTruthy();
	});

	it("report id starts with report_", () => {
		const report = reporter.generateReport(period);
		expect(report.id).toMatch(/^report_/);
	});
});
