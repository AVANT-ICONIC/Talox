import { describe, it, expect, beforeEach } from "vitest";
import { AdaptiveExperimentPriority } from "../../../../src/core/research/AdaptiveExperimentPriority.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { StrategyPromotion } from "../../../../src/core/research/types.js";

describe("AdaptiveExperimentPriority — Integration", () => {
	let journal: ResearchJournal;
	let priority: AdaptiveExperimentPriority;

	beforeEach(() => {
		journal = new ResearchJournal({});
		priority = new AdaptiveExperimentPriority(journal, { seed: 42 });
	});

	it("registers arms and tracks count", () => {
		priority.registerArm("stealth-fast");
		priority.registerArm("stealth-slow");
		priority.registerArm("aggressive");

		expect(priority.armCount).toBe(3);
	});

	it("does not double-register same arm", () => {
		priority.registerArm("same");
		priority.registerArm("same");
		expect(priority.armCount).toBe(1);
	});

	it("records outcomes and updates estimated value", () => {
		priority.registerArm("good-strategy");

		// 8 successes, 2 failures → 80% estimated value
		for (let i = 0; i < 8; i++) priority.recordOutcome("good-strategy", true);
		for (let i = 0; i < 2; i++) priority.recordOutcome("good-strategy", false);

		const stats = priority.getArmStats("good-strategy")!;
		expect(stats.sampleCount).toBe(10);
		// Thompson sampling uses alpha/(alpha+beta), not raw ratio
		// With seed=42 initialization, alpha/beta have priors that shift the estimate
		expect(stats.estimatedValue).toBeGreaterThan(0.5);
		expect(stats.estimatedValue).toBeLessThan(1.0);
	});

	it("Thompson sampling converges to best arm over many rounds", () => {
		priority.registerArm("best");   // will get many successes
		priority.registerArm("medium"); // some successes
		priority.registerArm("worst");  // mostly failures

		// Seeded PRNG for deterministic outcomes (mulberry32)
		let outcomeSeed = 12345;
		const seededRandom = () => {
			outcomeSeed |= 0;
			outcomeSeed = (outcomeSeed + 0x6d2b79f5) | 0;
			let t = Math.imul(outcomeSeed ^ (outcomeSeed >>> 15), 1 | outcomeSeed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};

		// Simulate 200 rounds of selection + outcome
		const selections = new Map<string, number>();
		for (let round = 0; round < 200; round++) {
			const selected = priority.selectNext()!;
			selections.set(selected, (selections.get(selected) ?? 0) + 1);

			// Simulate outcomes: best=90%, medium=50%, worst=10%
			if (selected === "best") {
				priority.recordOutcome(selected, seededRandom() < 0.9);
			} else if (selected === "medium") {
				priority.recordOutcome(selected, seededRandom() < 0.5);
			} else {
				priority.recordOutcome(selected, seededRandom() < 0.1);
			}
		}

		// Best arm should be selected most often
		expect(selections.get("best")!).toBeGreaterThan(selections.get("worst")!);
		expect(selections.get("best")!).toBeGreaterThan(selections.get("medium")!);

		// Rankings should reflect true ordering
		const ranked = priority.getRankedArms();
		expect(ranked[0]!.name).toBe("best");
		expect(ranked[2]!.name).toBe("worst");
	});

	it("getBestArm returns highest value arm", () => {
		priority.registerArm("a");
		priority.registerArm("b");

		// Make 'b' clearly better
		for (let i = 0; i < 10; i++) priority.recordOutcome("b", true);
		for (let i = 0; i < 10; i++) priority.recordOutcome("a", false);

		const best = priority.getBestArm()!;
		expect(best.name).toBe("b");
		expect(best.estimatedValue).toBeGreaterThan(0.9);
	});

	it("selectNext returns null with no arms", () => {
		expect(priority.selectNext()).toBeNull();
	});

	it("removes arms correctly", () => {
		priority.registerArm("to-remove");
		expect(priority.armCount).toBe(1);
		expect(priority.removeArm("to-remove")).toBe(true);
		expect(priority.armCount).toBe(0);
		expect(priority.removeArm("nope")).toBe(false);
	});

	it("initializes from journal history with promoted strategies", () => {
		// Add some promotions to journal
		const promo1: StrategyPromotion = {
			strategyName: "promoted-A", domain: "x.com",
			winningParameters: {}, evidence: ["e1"], promotedAt: new Date().toISOString(),
		};
		const promo2: StrategyPromotion = {
			strategyName: "promoted-B", domain: "reddit.com",
			winningParameters: {}, evidence: ["e2"], promotedAt: new Date().toISOString(),
		};
		journal.recordStrategyPromotion(promo1);
		journal.recordStrategyPromotion(promo2);

		priority.initializeFromHistory();

		expect(priority.armCount).toBe(2);
		const statsA = priority.getArmStats("promoted-A")!;
		// Promoted strategies get alpha bonus of +3
		expect(statsA.alpha).toBeGreaterThanOrEqual(4); // 1 base + 3 bonus
	});

	it("getArmStats returns null for unknown arm", () => {
		expect(priority.getArmStats("unknown")).toBeNull();
	});
});
