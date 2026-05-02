import { describe, it, expect, beforeEach } from "vitest";
import { StrategyComposer } from "../../../src/core/research/StrategyComposer.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { StrategyPromotion } from "../../../src/core/research/types.js";

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

describe("StrategyComposer", () => {
	let journal: ResearchJournal;
	let composer: StrategyComposer;

	beforeEach(() => {
		journal = new ResearchJournal();
		composer = new StrategyComposer(journal, 0.7);
	});

	it("returns empty candidates when no promotions exist", () => {
		expect(composer.discoverCandidates()).toEqual([]);
	});

	it("returns empty candidates when only one promoted strategy exists", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		expect(composer.discoverCandidates()).toEqual([]);
	});

	it("generates sequential, parallel, and conditional compositions", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		journal.recordStrategyPromotion(makePromotion({ strategyName: "b", domain: "x.com" }));

		const candidates = composer.discoverCandidates();
		expect(candidates.length).toBeGreaterThanOrEqual(3);

		const types = new Set(candidates.map((c) => c.applicationOrder));
		expect(types.has("sequential")).toBe(true);
		expect(types.has("parallel")).toBe(true);
		expect(types.has("conditional")).toBe(true);
	});

	it("does not create same-domain compositions from single strategy", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		const candidates = composer.discoverCandidates();
		expect(candidates).toEqual([]);
	});

	it("generates cross-domain compositions", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		journal.recordStrategyPromotion(makePromotion({ strategyName: "b", domain: "y.com" }));

		const candidates = composer.discoverCandidates();
		const crossDomain = candidates.find((c) => c.name.includes("XDomain"));
		expect(crossDomain).toBeDefined();
	});

	it("recordComposition stores and returns composition", () => {
		const comp = {
			id: "comp_1",
			name: "A + B",
			componentStrategies: ["A", "B"],
			applicationOrder: "parallel" as const,
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
		composer.recordComposition(comp);
		expect(composer.getComposedStrategies()).toHaveLength(1);
	});

	it("recordComposition writes to journal", () => {
		const comp = {
			id: "comp_1",
			name: "A + B",
			componentStrategies: ["A", "B"],
			applicationOrder: "parallel" as const,
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
		composer.recordComposition(comp);
		expect(journal.getEntries("strategy_composed")).toHaveLength(1);
	});

	it("getBestForDomain returns null when no compositions above threshold", () => {
		expect(composer.getBestForDomain("x.com")).toBeNull();
	});

	it("getBestForDomain returns highest fitness composition", () => {
		const comp1 = {
			id: "comp_1",
			name: "A + B",
			componentStrategies: ["A", "B"],
			applicationOrder: "parallel" as const,
			fitnessScore: 0.8,
			createdAt: new Date().toISOString(),
		};
		const comp2 = {
			id: "comp_2",
			name: "A → C",
			componentStrategies: ["A", "C"],
			applicationOrder: "sequential" as const,
			fitnessScore: 0.9,
			createdAt: new Date().toISOString(),
		};
		composer.recordComposition(comp1);
		composer.recordComposition(comp2);

		const best = composer.getBestForDomain("any");
		expect(best).not.toBeNull();
		expect(best!.fitnessScore).toBe(0.9);
	});

	it("getBestForDomain skips compositions below confidence threshold", () => {
		const comp = {
			id: "comp_1",
			name: "Low Fitness",
			componentStrategies: ["A"],
			applicationOrder: "parallel" as const,
			fitnessScore: 0.3,
			createdAt: new Date().toISOString(),
		};
		composer.recordComposition(comp);
		expect(composer.getBestForDomain("any")).toBeNull();
	});

	it("candidate names contain strategy names", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "alpha", domain: "x.com" }));
		journal.recordStrategyPromotion(makePromotion({ strategyName: "beta", domain: "x.com" }));

		const candidates = composer.discoverCandidates();
		for (const c of candidates) {
			const hasAlphaOrBeta = c.name.includes("alpha") || c.name.includes("beta");
			expect(hasAlphaOrBeta).toBe(true);
		}
	});

	it("all candidates have unique ids", () => {
		journal.recordStrategyPromotion(makePromotion({ strategyName: "a", domain: "x.com" }));
		journal.recordStrategyPromotion(makePromotion({ strategyName: "b", domain: "x.com" }));

		const candidates = composer.discoverCandidates();
		const ids = candidates.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
