import { beforeEach, describe, expect, it } from "vitest";
import { CrossDomainTransfer } from "../../../src/core/research/CrossDomainTransfer.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { ExperimentRun, StrategyPromotion } from "../../../src/core/research/types.js";

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
	return {
		id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		experimentId: "exp_1",
		hypothesis: { id: "h1", variant: "default", parameters: {}, description: "test", changeDescription: "none" },
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
		metrics: {
			iterationsToGoal: 5,
			totalDurationMs: 1000,
			totalCostUsd: 0.01,
			blockerCount: 0,
			blockerTypes: [],
			goalAchieved: true,
			skillsCreated: 0,
			strategySuccessRate: 0.8,
		},
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

function makePromotion(overrides: Partial<StrategyPromotion> = {}): StrategyPromotion {
	return {
		strategyName: "strat-a",
		domain: "example.com",
		winningParameters: {},
		evidence: [],
		promotedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("CrossDomainTransfer", () => {
	let journal: ResearchJournal;
	let transfer: CrossDomainTransfer;

	beforeEach(() => {
		journal = new ResearchJournal();
		transfer = new CrossDomainTransfer(journal);
	});

	it("returns empty candidates when no promotions exist", () => {
		expect(transfer.findTransferCandidates("c.com")).toEqual([]);
	});

	it("returns empty candidates when target domain has no features (no runs)", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		// Target "c.com" has no runs → getDomainFeatures returns null
		expect(transfer.findTransferCandidates("c.com")).toEqual([]);
	});

	it("finds transfer candidates when both domains have runs and promotions exist", () => {
		// Give the target domain some runs so getDomainFeatures returns non-null
		const targetRun = makeRun({
			domain: "c.com",
			hypothesis: {
				id: "h1",
				variant: "strat-x",
				parameters: {},
				domain: "c.com",
				description: "test",
				changeDescription: "none",
			},
			metrics: {
				iterationsToGoal: 8,
				totalDurationMs: 2000,
				totalCostUsd: 0.02,
				blockerCount: 1,
				blockerTypes: ["captcha"],
				goalAchieved: true,
				skillsCreated: 0,
				strategySuccessRate: 0.7,
			},
		});
		journal.recordExperimentRun(targetRun);

		// Give the source domain runs + a promotion
		const sourceRun = makeRun({
			domain: "a.com",
			hypothesis: {
				id: "h2",
				variant: "strat-x",
				parameters: {},
				domain: "a.com",
				description: "test",
				changeDescription: "none",
			},
			metrics: {
				iterationsToGoal: 3,
				totalDurationMs: 500,
				totalCostUsd: 0.01,
				blockerCount: 1,
				blockerTypes: ["captcha"],
				goalAchieved: true,
				skillsCreated: 0,
				strategySuccessRate: 0.9,
			},
		});
		journal.recordExperimentRun(sourceRun);
		// Need enough runs for source to have successRate >= 0.6
		for (let i = 0; i < 5; i++) {
			journal.recordExperimentRun(
				makeRun({
					domain: "a.com",
					hypothesis: {
						id: `h-src-${i}`,
						variant: "strat-x",
						parameters: {},
						domain: "a.com",
						description: "test",
						changeDescription: "none",
					},
					metrics: {
						iterationsToGoal: 3,
						totalDurationMs: 500,
						totalCostUsd: 0.01,
						blockerCount: 1,
						blockerTypes: ["captcha"],
						goalAchieved: true,
						skillsCreated: 0,
						strategySuccessRate: 0.9,
					},
				}),
			);
		}

		journal.recordStrategyPromotion(
			makePromotion({ strategyName: "speed-v1", domain: "a.com", winningParameters: { retries: 5 } }),
		);

		const candidates = transfer.findTransferCandidates("c.com");
		expect(candidates.length).toBeGreaterThan(0);
	});

	it("does not include promotions from the target domain itself", () => {
		// Give both domains runs
		for (let i = 0; i < 5; i++) {
			journal.recordExperimentRun(
				makeRun({
					domain: "b.com",
					hypothesis: { id: `ht-${i}`, variant: "s1", parameters: {}, description: "test", changeDescription: "none" },
				}),
			);
		}
		for (let i = 0; i < 5; i++) {
			journal.recordExperimentRun(
				makeRun({
					domain: "a.com",
					hypothesis: { id: `hs-${i}`, variant: "s1", parameters: {}, description: "test", changeDescription: "none" },
				}),
			);
		}

		journal.recordStrategyPromotion(makePromotion({ strategyName: "s1", domain: "a.com" }));
		// Promotion for b.com (the target) should not appear since we skip targetDomain
		journal.recordStrategyPromotion(makePromotion({ strategyName: "s1", domain: "b.com" }));

		const candidates = transfer.findTransferCandidates("b.com");
		// b.com's own promotions should not be suggested — only other domains
		const hasBPromotion = candidates.some((c) => c.domain === "b.com");
		expect(hasBPromotion).toBe(false);
	});

	it("records transfer and stores in journal", () => {
		const record = transfer.recordTransfer("a.com", "b.com", "speed-v1", 1.5);
		expect(record.sourceDomain).toBe("a.com");
		expect(record.targetDomain).toBe("b.com");
		expect(record.strategyName).toBe("speed-v1");
		expect(record.transferSuccess).toBe(true);
		expect(record.improvementRatio).toBe(1.5);

		const entries = journal.getEntries("cross_domain_transfer");
		expect(entries).toHaveLength(1);
	});

	it("records failed transfer when improvement ratio <= 1.0", () => {
		const record = transfer.recordTransfer("a.com", "b.com", "slow-v1", 0.5);
		expect(record.transferSuccess).toBe(false);
	});

	it("getSimilarDomains returns empty for unknown domain", () => {
		expect(transfer.getSimilarDomains("unknown.com")).toEqual([]);
	});
});
