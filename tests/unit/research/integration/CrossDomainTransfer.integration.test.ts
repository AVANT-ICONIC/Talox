import { describe, it, expect, beforeEach } from "vitest";
import { CrossDomainTransfer } from "../../../../src/core/research/CrossDomainTransfer.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { ExperimentRun, RunMetrics, StrategyPromotion } from "../../../../src/core/research/types.js";

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
	return {
		iterationsToGoal: 5, totalDurationMs: 1000, totalCostUsd: 0.01,
		blockerCount: 0, blockerTypes: [], goalAchieved: true,
		skillsCreated: 0, strategySuccessRate: 1.0, ...overrides,
	};
}

function makeRun(domain: string, variant: string, metrics?: Partial<RunMetrics>): ExperimentRun {
	return {
		id: `run_${domain}_${variant}`,
		experimentId: `exp_${domain}`,
		hypothesis: { id: `hyp_${variant}`, description: "test", variant, changeDescription: "none", parameters: {} },
		goal: "test goal", domain,
		result: {
			status: metrics?.goalAchieved === false ? "failed" : "completed",
			goal: { description: "test", maxIterations: 10 },
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

describe("CrossDomainTransfer — Integration", () => {
	let journal: ResearchJournal;
	let transfer: CrossDomainTransfer;

	beforeEach(() => {
		journal = new ResearchJournal({});
		transfer = new CrossDomainTransfer(journal);
	});

	it("finds transfer candidates from similar domains", () => {
		// Both domains use same strategies and blocker types → high similarity
		for (let i = 0; i < 3; i++) {
			journal.recordExperimentRun(makeRun("reddit.com", "control", {
				goalAchieved: true, blockerTypes: ["captcha" as any, "cloudflare" as any],
			}));
		}
		for (let i = 0; i < 3; i++) {
			journal.recordExperimentRun(makeRun("x.com", "control", {
				goalAchieved: true, blockerTypes: ["captcha" as any, "cloudflare" as any],
			}));
		}

		// Promote a strategy on reddit
		const promo: StrategyPromotion = {
			strategyName: "stealth-aggressive",
			domain: "reddit.com",
			winningParameters: { stealthLevel: 0.3 },
			evidence: ["run_1", "run_2"],
			promotedAt: new Date().toISOString(),
		};
		journal.recordStrategyPromotion(promo);

		// Now find candidates for x.com
		const candidates = transfer.findTransferCandidates("x.com");
		expect(candidates.length).toBeGreaterThan(0);
		expect(candidates[0]!.strategyName).toBe("stealth-aggressive");
	});

	it("records transfer outcomes correctly", () => {
		// Need runs on both domains first
		journal.recordExperimentRun(makeRun("a.com", "control"));
		journal.recordExperimentRun(makeRun("b.com", "control"));

		const record = transfer.recordTransfer("a.com", "b.com", "strat-1", 1.5);
		expect(record.transferSuccess).toBe(true);
		expect(record.improvementRatio).toBe(1.5);

		const failRecord = transfer.recordTransfer("a.com", "b.com", "strat-2", 0.7);
		expect(failRecord.transferSuccess).toBe(false);
	});

	it("finds similar domains using Jaccard similarity", () => {
		// Set up 3 domains with varying similarity
		for (let i = 0; i < 3; i++) {
			journal.recordExperimentRun(makeRun("a.com", "control", { blockerTypes: ["captcha" as any] }));
			journal.recordExperimentRun(makeRun("b.com", "control", { blockerTypes: ["captcha" as any] }));
			journal.recordExperimentRun(makeRun("c.com", "control", { blockerTypes: ["login" as any] }));
		}

		const similar = transfer.getSimilarDomains("a.com");
		expect(similar).toContain("b.com");
		// c.com has different blocker types, may or may not appear depending on threshold
	});

	it("returns empty candidates for unknown domains", () => {
		journal.recordExperimentRun(makeRun("solo.com", "control"));
		const candidates = transfer.findTransferCandidates("solo.com");
		expect(candidates).toEqual([]);
	});

	it("returns empty similar domains for no-history domain", () => {
		const similar = transfer.getSimilarDomains("never-seen.com");
		expect(similar).toEqual([]);
	});
});
