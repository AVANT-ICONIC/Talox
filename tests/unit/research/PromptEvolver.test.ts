import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PromptEvolver } from "../../../src/core/research/PromptEvolver.js";
import { ResearchJournal } from "../../../src/core/research/ResearchJournal.js";
import { rm } from "node:fs/promises";

describe("PromptEvolver", () => {
	let journal: ResearchJournal;
	let evolver: PromptEvolver;
	let testDir: string;

	beforeEach(async () => {
		journal = new ResearchJournal();
		testDir = `/tmp/talox-test-prompt-evolver-${Date.now()}`;
		evolver = new PromptEvolver(journal, testDir);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("initializes with a seed prompt", async () => {
		await evolver.initialize("You are a helpful browsing agent.");
		const best = evolver.getBestPrompt();
		expect(best).not.toBeNull();
		expect(typeof best!.systemPrompt).toBe("string");
		expect(best!.systemPrompt.length).toBeGreaterThan(0);
	});

	it("creates a population of variants", async () => {
		await evolver.initialize("You are a helpful agent. Be fast.");
		// Population should have 5 variants (populationSize)
		const v0 = evolver.getVariant(0);
		const v1 = evolver.getVariant(1);
		expect(v0).not.toBeNull();
		expect(v1).not.toBeNull();
		expect(v0!.id).not.toBe(v1!.id);
	});

	it("getVariant returns null when population is empty", () => {
		expect(evolver.getVariant(0)).toBeNull();
	});

	it("getBestPrompt returns null when not initialized", () => {
		expect(evolver.getBestPrompt()).toBeNull();
	});

	it("recordFitness updates fitness score for a variant", async () => {
		await evolver.initialize("seed prompt");
		const variant = evolver.getVariant(0)!;

		await evolver.recordFitness(variant.id, {
			iterationsToGoal: 3,
			totalDurationMs: 500,
			totalCostUsd: 0.01,
			blockerCount: 0,
			blockerTypes: [],
			goalAchieved: true,
			skillsCreated: 0,
			strategySuccessRate: 0.9,
		});

		// Re-fetch the variant — fitness should be > 0
		const updated = evolver.getVariant(0);
		expect(updated!.fitnessScore).toBeGreaterThan(0);
	});

	it("recordFitness ignores unknown variant id", async () => {
		await evolver.initialize("seed");
		// Should not throw
		await evolver.recordFitness("nonexistent_id", {
			iterationsToGoal: 3,
			totalDurationMs: 500,
			totalCostUsd: 0.01,
			blockerCount: 0,
			blockerTypes: [],
			goalAchieved: true,
			skillsCreated: 0,
			strategySuccessRate: 0.9,
		});
	});

	it("evolves when all variants have fitness > 0", async () => {
		await evolver.initialize("seed prompt");

		// Score all 5 variants to trigger evolution
		for (let i = 0; i < 5; i++) {
			const v = evolver.getVariant(i)!;
			await evolver.recordFitness(v.id, {
				iterationsToGoal: 3,
				totalDurationMs: 500,
				totalCostUsd: 0.01,
				blockerCount: 0,
				blockerTypes: [],
				goalAchieved: true,
				skillsCreated: 0,
				strategySuccessRate: 0.9,
			});
		}

		// After all scored, evolution should have occurred
		// The best prompt should still be non-null
		const best = evolver.getBestPrompt();
		expect(best).not.toBeNull();
	});

	it("computes higher fitness for goal-achieved runs", async () => {
		await evolver.initialize("seed");

		const v1 = evolver.getVariant(0)!;
		await evolver.recordFitness(v1.id, {
			iterationsToGoal: 2,
			totalDurationMs: 100,
			totalCostUsd: 0,
			blockerCount: 0,
			blockerTypes: [],
			goalAchieved: true,
			skillsCreated: 0,
			strategySuccessRate: 1.0,
		});

		const v2 = evolver.getVariant(1)!;
		await evolver.recordFitness(v2.id, {
			iterationsToGoal: 20,
			totalDurationMs: 10000,
			totalCostUsd: 1.0,
			blockerCount: 10,
			blockerTypes: ["captcha"],
			goalAchieved: false,
			skillsCreated: 0,
			strategySuccessRate: 0.1,
		});

		// v1 should have higher fitness
		const best = evolver.getBestPrompt();
		expect(best!.id).toBe(v1.id);
	});

	it("persists population to disk on initialize", async () => {
		await evolver.initialize("seed prompt");
		const { readFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const raw = await readFile(join(testDir, "prompt-population.json"), "utf-8");
		const population = JSON.parse(raw);
		expect(Array.isArray(population)).toBe(true);
		expect(population.length).toBeGreaterThan(0);
	});

	it("loads existing population from disk", async () => {
		await evolver.initialize("first seed");

		const evolver2 = new PromptEvolver(journal, testDir);
		await evolver2.initialize("different seed");
		// Should have loaded from disk, not re-initialized
		const best = evolver2.getBestPrompt();
		expect(best).not.toBeNull();
	});
});
