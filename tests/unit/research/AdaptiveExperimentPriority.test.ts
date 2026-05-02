import { describe, it, expect, beforeEach } from "vitest";
import { AdaptiveExperimentPriority } from "../../../src/core/research/AdaptiveExperimentPriority.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import type { StrategyPromotion } from "../../../src/core/research/types.js";

describe("AdaptiveExperimentPriority", () => {
	let journal: ResearchJournal;
	let priority: AdaptiveExperimentPriority;

	beforeEach(() => {
		journal = new ResearchJournal();
		priority = new AdaptiveExperimentPriority(journal, { seed: 42 });
	});

	it("starts with no arms", () => {
		expect(priority.armCount).toBe(0);
		expect(priority.getBestArm()).toBeNull();
	});

	it("registers arms", () => {
		priority.registerArm("strategy-a");
		expect(priority.armCount).toBe(1);
		const stats = priority.getArmStats("strategy-a");
		expect(stats).not.toBeNull();
		expect(stats!.alpha).toBe(1);
		expect(stats!.beta).toBe(1);
		expect(stats!.sampleCount).toBe(0);
	});

	it("does not re-register existing arm", () => {
		priority.registerArm("a");
		priority.registerArm("a");
		expect(priority.armCount).toBe(1);
	});

	it("recordOutcome updates alpha on success", () => {
		priority.registerArm("a");
		priority.recordOutcome("a", true);
		const stats = priority.getArmStats("a")!;
		expect(stats.alpha).toBe(2);
		expect(stats.sampleCount).toBe(1);
		expect(stats.estimatedValue).toBeCloseTo(2 / 3);
	});

	it("recordOutcome updates beta on failure", () => {
		priority.registerArm("a");
		priority.recordOutcome("a", false);
		const stats = priority.getArmStats("a")!;
		expect(stats.beta).toBe(2);
		expect(stats.sampleCount).toBe(1);
		expect(stats.estimatedValue).toBeCloseTo(1 / 3);
	});

	it("recordOutcome ignores unknown arm", () => {
		priority.recordOutcome("unknown", true);
		expect(priority.armCount).toBe(0);
	});

	it("selectNext returns null when no arms", () => {
		expect(priority.selectNext()).toBeNull();
	});

	it("selectNext returns a registered arm", () => {
		priority.registerArm("a");
		priority.registerArm("b");
		const selected = priority.selectNext();
		expect(selected).not.toBeNull();
		expect(["a", "b"]).toContain(selected);
	});

	it("selectNext favors higher-reward arms over time", () => {
		priority.registerArm("good");
		priority.registerArm("bad");

		// Make "good" succeed a lot
		for (let i = 0; i < 50; i++) {
			priority.recordOutcome("good", true);
		}
		// Make "bad" fail a lot
		for (let i = 0; i < 50; i++) {
			priority.recordOutcome("bad", false);
		}

		// With 42 seed, sample repeatedly — good should win majority
		const p2 = new AdaptiveExperimentPriority(journal, { seed: 42 });
		p2.registerArm("good");
		p2.registerArm("bad");
		for (let i = 0; i < 50; i++) { p2.recordOutcome("good", true); }
		for (let i = 0; i < 50; i++) { p2.recordOutcome("bad", false); }

		let goodCount = 0;
		for (let i = 0; i < 100; i++) {
			if (p2.selectNext() === "good") goodCount++;
		}
		expect(goodCount).toBeGreaterThan(50);
	});

	it("getRankedArms sorts by estimated value descending", () => {
		priority.registerArm("low");
		priority.registerArm("high");
		priority.registerArm("mid");

		// Manipulate values
		for (let i = 0; i < 10; i++) priority.recordOutcome("high", true);
		for (let i = 0; i < 10; i++) priority.recordOutcome("mid", true);
		for (let i = 0; i < 5; i++) priority.recordOutcome("mid", false);
		for (let i = 0; i < 10; i++) priority.recordOutcome("low", false);

		const ranked = priority.getRankedArms();
		expect(ranked[0]!.name).toBe("high");
		expect(ranked[ranked.length - 1]!.name).toBe("low");
	});

	it("getBestArm returns highest estimated value", () => {
		priority.registerArm("a");
		priority.registerArm("b");
		for (let i = 0; i < 20; i++) priority.recordOutcome("b", true);
		for (let i = 0; i < 20; i++) priority.recordOutcome("a", false);

		const best = priority.getBestArm();
		expect(best!.name).toBe("b");
	});

	it("removeArm removes an arm", () => {
		priority.registerArm("a");
		expect(priority.removeArm("a")).toBe(true);
		expect(priority.armCount).toBe(0);
		expect(priority.getArmStats("a")).toBeNull();
	});

	it("removeArm returns false for unknown", () => {
		expect(priority.removeArm("unknown")).toBe(false);
	});

	it("initializeFromHistory loads promoted strategies with bonus", () => {
		journal.recordStrategyPromotion({
			strategyName: "promoted-strat",
			domain: "a.com",
			winningParameters: {},
			evidence: [],
			promotedAt: new Date().toISOString(),
		});

		priority.initializeFromHistory();
		expect(priority.armCount).toBe(1);
		const stats = priority.getArmStats("promoted-strat")!;
		// Starts at alpha=1, gets +3 bonus = 4
		expect(stats.alpha).toBe(4);
		expect(stats.sampleCount).toBe(3);
	});

	it("getArmStats returns null for unknown arm", () => {
		expect(priority.getArmStats("unknown")).toBeNull();
	});
});
