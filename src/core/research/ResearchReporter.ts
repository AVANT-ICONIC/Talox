/**
 * @file ResearchReporter.ts
 * @description Generates research reports — summaries of experiment outcomes,
 * strategy promotions, skill evaluations, and cross-domain transfers.
 *
 * Produces structured ResearchReport objects that can be rendered as
 * markdown, JSON, or HTML.
 */

import type { ResearchJournal } from "./ResearchJournal.js";
import type {
	DomainResearchSummary,
	ExperimentRun,
	ResearchFinding,
	ResearchReport,
	SkillEvaluation,
	StrategyPromotion,
} from "./types.js";

// ─── ResearchReporter ─────────────────────────────────────────────────────

export class ResearchReporter {
	private readonly journal: ResearchJournal;

	constructor(journal: ResearchJournal) {
		this.journal = journal;
	}

	/**
	 * Generate a research report for a time period.
	 */
	generateReport(period: { from: string; to: string }, title?: string): ResearchReport {
		const experiments = this.journal
			.getEntries("experiment_run")
			.map((e) => e.data as ExperimentRun)
			.filter((e) => {
				const ts = new Date(e.timestamp).getTime();
				return ts >= new Date(period.from).getTime() && ts <= new Date(period.to).getTime();
			});

		const evaluations = this.journal
			.getEntries("skill_evaluated")
			.map((e) => e.data as SkillEvaluation)
			.filter((e) => {
				const ts = new Date(e.timestamp).getTime();
				return ts >= new Date(period.from).getTime() && ts <= new Date(period.to).getTime();
			});

		const promotions = this.journal
			.getEntries("strategy_promoted")
			.map((e) => e.data as StrategyPromotion)
			.filter((e) => {
				const ts = new Date(e.promotedAt).getTime();
				return ts >= new Date(period.from).getTime() && ts <= new Date(period.to).getTime();
			});

		const findings = this.extractFindings(experiments, evaluations, promotions);
		const domainSummaries = this.buildDomainSummaries(experiments);

		const summary = this.buildSummary(experiments, evaluations, promotions, findings);

		return {
			id: `report_${Date.now()}`,
			title: title ?? `Research Report: ${period.from} to ${period.to}`,
			summary,
			period,
			experimentsConducted: experiments.length,
			strategiesPromoted: promotions.length,
			skillsEvaluated: evaluations.length,
			topFindings: findings,
			domainSummaries,
			generatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Render a report as markdown.
	 */
	renderMarkdown(report: ResearchReport): string {
		const lines: string[] = [];

		lines.push(`# ${report.title}`);
		lines.push("");
		lines.push(`**Period**: ${report.period.from} — ${report.period.to}`);
		lines.push(`**Generated**: ${report.generatedAt}`);
		lines.push("");
		lines.push("## Summary");
		lines.push(report.summary);
		lines.push("");
		lines.push("## Statistics");
		lines.push(`- **Experiments conducted**: ${report.experimentsConducted}`);
		lines.push(`- **Strategies promoted**: ${report.strategiesPromoted}`);
		lines.push(`- **Skills evaluated**: ${report.skillsEvaluated}`);
		lines.push("");

		if (report.topFindings.length > 0) {
			lines.push("## Top Findings");
			for (const finding of report.topFindings) {
				const impactEmoji = finding.impact === "high" ? "🔴" : finding.impact === "medium" ? "🟡" : "🟢";
				lines.push(`- ${impactEmoji} **(${finding.impact})** ${finding.description}`);
				lines.push(`  - Confidence: ${(finding.confidence * 100).toFixed(0)}%`);
				lines.push(`  - Evidence: ${finding.evidence.length} experiment(s)`);
			}
			lines.push("");
		}

		const domainEntries = Object.entries(report.domainSummaries);
		if (domainEntries.length > 0) {
			lines.push("## Domain Summaries");
			lines.push("");
			lines.push("| Domain | Runs | Success Rate | Avg Iterations | Best Strategy |");
			lines.push("|--------|------|-------------|----------------|----------------|");
			for (const [, summary] of domainEntries) {
				lines.push(
					`| ${summary.domain} | ${summary.totalRuns} | ${(summary.successRate * 100).toFixed(0)}% | ${summary.avgIterationsToGoal.toFixed(1)} | ${summary.bestStrategy ?? "—"} |`,
				);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	/**
	 * Render a report as JSON.
	 */
	renderJSON(report: ResearchReport): string {
		return JSON.stringify(report, null, 2);
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private extractFindings(
		experiments: ExperimentRun[],
		evaluations: SkillEvaluation[],
		promotions: StrategyPromotion[],
	): ResearchFinding[] {
		const findings: ResearchFinding[] = [];

		// Finding: promoted strategies
		for (const promo of promotions) {
			findings.push({
				description: `Strategy "${promo.strategyName}" promoted for domain ${promo.domain}`,
				confidence: Math.min(1, promo.evidence.length / 3),
				evidence: promo.evidence,
				impact: "high",
			});
		}

		// Finding: skills that helped
		const helpedSkills = evaluations.filter((e) => e.verdict === "helped");
		for (const eval_ of helpedSkills) {
			findings.push({
				description: `Skill "${eval_.skillName}" improved performance on ${eval_.domain} by ${(eval_.improvement * 100).toFixed(0)}%`,
				confidence: 0.8,
				evidence: [eval_.skillName],
				impact: eval_.improvement > 0.3 ? "high" : "medium",
			});
		}

		// Finding: skills that hurt
		const hurtSkills = evaluations.filter((e) => e.verdict === "hurt");
		for (const eval_ of hurtSkills) {
			findings.push({
				description: `Skill "${eval_.skillName}" degraded performance on ${eval_.domain} by ${(Math.abs(eval_.improvement) * 100).toFixed(0)}%`,
				confidence: 0.9,
				evidence: [eval_.skillName],
				impact: "high",
			});
		}

		// Finding: domains with low success rates
		const domainSuccess = new Map<string, { total: number; success: number }>();
		for (const exp of experiments) {
			const entry = domainSuccess.get(exp.domain) ?? { total: 0, success: 0 };
			entry.total++;
			if (exp.metrics.goalAchieved) entry.success++;
			domainSuccess.set(exp.domain, entry);
		}

		for (const [domain, { total, success }] of domainSuccess) {
			const rate = success / total;
			if (rate < 0.5 && total >= 3) {
				findings.push({
					description: `Domain "${domain}" has low success rate: ${(rate * 100).toFixed(0)}% (${success}/${total})`,
					confidence: 0.7,
					evidence: [`domain:${domain}`],
					impact: "medium",
				});
			}
		}

		// Sort by impact then confidence
		const impactOrder = { high: 0, medium: 1, low: 2 };
		findings.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact] || b.confidence - a.confidence);

		return findings.slice(0, 10); // Top 10 findings
	}

	private buildDomainSummaries(experiments: ExperimentRun[]): Record<string, DomainResearchSummary> {
		const summaries: Record<string, DomainResearchSummary> = {};
		for (const exp of experiments) {
			if (!summaries[exp.domain]) {
				summaries[exp.domain] = {
					domain: exp.domain,
					totalRuns: 0,
					successRate: 0,
					bestStrategy: null,
					knownSkills: [],
					avgIterationsToGoal: 0,
				};
			}
			const s = summaries[exp.domain]; if (!s) continue;
			s.totalRuns++;
			s.successRate = (s.successRate * (s.totalRuns - 1) + (exp.metrics.goalAchieved ? 1 : 0)) / s.totalRuns;
			s.avgIterationsToGoal = (s.avgIterationsToGoal * (s.totalRuns - 1) + exp.metrics.iterationsToGoal) / s.totalRuns;
		}
		return summaries;
	}

	private buildSummary(
		experiments: ExperimentRun[],
		evaluations: SkillEvaluation[],
		promotions: StrategyPromotion[],
		findings: ResearchFinding[],
	): string {
		const totalGoals = experiments.filter((e) => e.metrics.goalAchieved).length;
		const overallRate = experiments.length > 0 ? (totalGoals / experiments.length) * 100 : 0;
		const helped = evaluations.filter((e) => e.verdict === "helped").length;
		const hurt = evaluations.filter((e) => e.verdict === "hurt").length;

		return [
			`Conducted ${experiments.length} experiments across ${new Set(experiments.map((e) => e.domain)).size} domains.`,
			`Overall success rate: ${overallRate.toFixed(0)}%.`,
			`${promotions.length} strategies promoted.`,
			`${helped} skills helped, ${hurt} skills hurt performance.`,
			`${findings.length} notable findings identified.`,
		].join(" ");
	}
}
