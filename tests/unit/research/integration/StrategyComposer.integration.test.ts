import { describe, it, expect, beforeEach } from "vitest";
import { StrategyComposer } from "../../../../src/core/research/StrategyComposer.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { StrategyPromotion, ComposedStrategy } from "../../../../src/core/research/types.js";

describe("StrategyComposer — Integration", () => {
	let journal: ResearchJournal;
	let composer: StrategyComposer;

	beforeEach(() => {
		journal = new ResearchJournal({});
		composer = new StrategyComposer(journal, 0.7);
	});

	function addPromotion(strategyName: string, domain: string) {
		const promo: StrategyPromotion = {
			strategyName, domain,
			winningParameters: { stealthLevel: 0.5 },
			evidence: [`ev_${strategyName}`],
			promotedAt: new Date().toISOString(),
		};
		journal.recordStrategyPromotion(promo);
	}

	it("discovers sequential compositions from same-domain promotions", () => {
		addPromotion("stealth-fast", "reddit.com");
		addPromotion("stealth-slow", "reddit.com");

		const candidates = composer.discoverCandidates();
		expect(candidates.length).toBeGreaterThan(0);

		const sequential = candidates.filter(c => c.applicationOrder === "sequential");
		expect(sequential.length).toBeGreaterThanOrEqual(2); // A→B and B→A
	});

	it("discovers parallel compositions", () => {
		addPromotion("strat-a", "x.com");
		addPromotion("strat-b", "x.com");

		const candidates = composer.discoverCandidates();
		const parallel = candidates.filter(c => c.applicationOrder === "parallel");
		expect(parallel.length).toBeGreaterThan(0);
	});

	it("discovers conditional compositions", () => {
		addPromotion("primary", "test.com");
		addPromotion("fallback", "test.com");

		const candidates = composer.discoverCandidates();
		const conditional = candidates.filter(c => c.applicationOrder === "conditional");
		expect(conditional.length).toBeGreaterThan(0);
		expect(conditional[0]!.condition).toBeTruthy();
	});

	it("discovers cross-domain compositions when multiple domains have promotions", () => {
		addPromotion("reddit-strat", "reddit.com");
		addPromotion("x-strat", "x.com");

		const candidates = composer.discoverCandidates();
		const crossDomain = candidates.filter(c => c.name.includes("XDomain"));
		expect(crossDomain.length).toBeGreaterThan(0);
	});

	it("records compositions and retrieves them", () => {
		const comp: ComposedStrategy = {
			id: "comp_test",
			name: "A + B",
			componentStrategies: ["A", "B"],
			applicationOrder: "parallel",
			fitnessScore: 0.85,
			createdAt: new Date().toISOString(),
		};

		composer.recordComposition(comp);
		const strategies = composer.getComposedStrategies();
		expect(strategies).toHaveLength(1);
		expect(strategies[0]!.id).toBe("comp_test");
	});

	it("getBestForDomain returns highest fitness above threshold", () => {
		// Need promotions for domain tracking
		addPromotion("s1", "target.com");

		composer.recordComposition({
			id: "comp_1", name: "low fitness", componentStrategies: ["a", "b"],
			applicationOrder: "sequential", fitnessScore: 0.3,
			createdAt: new Date().toISOString(),
		});
		composer.recordComposition({
			id: "comp_2", name: "high fitness", componentStrategies: ["c", "d"],
			applicationOrder: "parallel", fitnessScore: 0.9,
			createdAt: new Date().toISOString(),
		});
		composer.recordComposition({
			id: "comp_3", name: "medium fitness", componentStrategies: ["e", "f"],
			applicationOrder: "conditional", fitnessScore: 0.75,
			createdAt: new Date().toISOString(),
		});

		const best = composer.getBestForDomain("target.com");
		expect(best).not.toBeNull();
		expect(best!.fitnessScore).toBe(0.9);
	});

	it("getBestForDomain returns null when no compositions pass threshold", () => {
		composer.recordComposition({
			id: "comp_low", name: "low", componentStrategies: ["a"],
			applicationOrder: "sequential", fitnessScore: 0.2,
			createdAt: new Date().toISOString(),
		});

		const best = composer.getBestForDomain("any.com");
		expect(best).toBeNull();
	});

	it("returns empty candidates when no promotions exist", () => {
		const candidates = composer.discoverCandidates();
		expect(candidates).toEqual([]);
	});
});
