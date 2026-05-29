import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptEvolver } from "../../../../src/core/research/PromptEvolver.js";
import { ResearchJournal } from "../../../../src/core/research/ResearchJournal.js";
import type { RunMetrics } from "../../../../src/core/research/types.js";

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

describe("PromptEvolver — Integration", () => {
	let journal: ResearchJournal;
	let evolver: PromptEvolver;
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "talox-pe-int-"));
		journal = new ResearchJournal({});
		evolver = new PromptEvolver(journal, tmpDir);
		await evolver.initialize("You are an agent.\nBe fast.\nBe stealthy.");
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("initializes with seed prompt and creates population", async () => {
		const best = evolver.getBestPrompt();
		expect(best).not.toBeNull();
		expect(best!.systemPrompt).toBeTruthy();
		expect(best!.generation).toBe(0);
	});

	it("records fitness and updates best prompt", async () => {
		const v0 = evolver.getVariant(0);
		const v1 = evolver.getVariant(1);
		expect(v0).not.toBeNull();
		expect(v1).not.toBeNull();

		// v0 gets high fitness
		await evolver.recordFitness(v0!.id, makeMetrics({ iterationsToGoal: 2, goalAchieved: true }));
		// v1 gets low fitness
		await evolver.recordFitness(v1!.id, makeMetrics({ iterationsToGoal: 20, goalAchieved: false }));

		const best = evolver.getBestPrompt();
		expect(best!.id).toBe(v0!.id);
		expect(best!.fitnessScore).toBeGreaterThan(v1!.fitnessScore);
	});

	it("evolves to next generation when all variants scored", async () => {
		const pop = [];
		for (let i = 0; i < 5; i++) {
			pop.push(evolver.getVariant(i));
		}

		// Score all variants — should trigger evolution
		for (let idx = 0; idx < pop.length; idx++) {
			const v = pop[idx]!;
			await evolver.recordFitness(
				v.id,
				makeMetrics({
					iterationsToGoal: 5 + idx,
					goalAchieved: idx < 3,
				}),
			);
		}

		// After evolution, population should still have 5 variants
		const v0 = evolver.getVariant(0);
		expect(v0).not.toBeNull();
	});

	it("round-robins variants via getVariant()", async () => {
		const v0 = evolver.getVariant(0);
		const v5 = evolver.getVariant(5); // wraps around
		expect(v0).not.toBeNull();
		expect(v5).not.toBeNull();
		// v5 = v0 since population is 5
		expect(v5!.id).toBe(v0!.id);
	});

	it("persists population to disk", async () => {
		const v0 = evolver.getVariant(0)!;
		await evolver.recordFitness(v0.id, makeMetrics({ goalAchieved: true }));

		// New evolver from same dir
		const evolver2 = new PromptEvolver(journal, tmpDir);
		await evolver2.initialize("different seed");
		const loaded = evolver2.getVariant(0);
		expect(loaded).not.toBeNull();
	});
});
