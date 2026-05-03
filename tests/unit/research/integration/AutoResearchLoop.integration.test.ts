import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutoResearchLoop, DEFAULT_RESEARCH_CONFIG } from "../../../../src/core/research/AutoResearchLoop.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AutoResearchLoop — Integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "talox-arl-int-"));
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	});

	it("initializes and creates research directory", async () => {
		const loop = new AutoResearchLoop(
			async () => ({ run: async () => makeResult() }) as any,
			{ config: { researchDir: tmpDir, persistToDisk: true } },
		);

		await loop.initialize();

		const { statSync } = await import("node:fs");
		expect(() => statSync(tmpDir)).not.toThrow();
	});

	it("runs a full research cycle with mock loop factory", async () => {
		let callCount = 0;
		const loopFactory = async () => ({
			run: async () => {
				callCount++;
				return {
					status: callCount > 2 ? "completed" : "failed",
					goal: { description: "test", maxIterations: 10 },
					totalIterations: callCount,
					totalDurationMs: callCount * 100,
					totalCostUsd: 0.01 * callCount,
					createdSkills: callCount > 3 ? ["skill-1"] : [],
					stopReason: callCount > 2 ? "goal-achieved" : "max-iterations",
				};
			},
		}) as any;

		const loop = new AutoResearchLoop(loopFactory, {
			config: {
				researchDir: tmpDir,
				persistToDisk: false,
				enableCrossDomainTransfer: false,
				enablePromptEvolution: false,
			},
		});

		const result = await loop.run(
			{ description: "Navigate to example.com", maxIterations: 10 },
			"example.com",
		);

		expect(result).toBeTruthy();
		expect(result.loopResult).toBeTruthy();
		expect(result.experiments).toBeInstanceOf(Array);
		expect(result.promotions).toBeInstanceOf(Array);
		expect(result.journal).toBeTruthy();
		expect(result.journal.version).toBe(1);
		expect(callCount).toBeGreaterThan(0);
	});

	it("generates a report after running experiments", async () => {
		const loopFactory = async () => ({
			run: async () => makeResult(),
		}) as any;

		const loop = new AutoResearchLoop(loopFactory, {
			config: {
				researchDir: tmpDir,
				persistToDisk: false,
				enableCrossDomainTransfer: false,
				enablePromptEvolution: false,
			},
		});

		await loop.run(
			{ description: "test goal", maxIterations: 10 },
			"test.com",
		);

		const now = new Date();
		const report = loop.generateReport({
			from: new Date(now.getTime() - 86_400_000).toISOString(),
			to: now.toISOString(),
		});

		expect(report).toBeTruthy();
		expect(report.id).toContain("report_");
	});

	it("exposes journal, priority, and composer", async () => {
		const loopFactory = async () => ({
			run: async () => makeResult(),
		}) as any;

		const loop = new AutoResearchLoop(loopFactory, {
			config: { researchDir: tmpDir, persistToDisk: false },
		});

		expect(loop.getJournal()).toBeTruthy();
		expect(loop.getPriority()).toBeTruthy();
		expect(loop.getComposer()).toBeTruthy();
	});

	it("respects excluded domains in config", async () => {
		let factoryCalled = false;
		const loopFactory = async () => {
			factoryCalled = true;
			return { run: async () => makeResult() } as any;
		};

		// Excluded domain config shouldn't prevent AutoResearchLoop.run()
		// but ExperimentRunner checks exclusion internally
		const loop = new AutoResearchLoop(loopFactory, {
			config: {
				researchDir: tmpDir,
				persistToDisk: false,
				excludedDomains: ["excluded.com"],
				enableCrossDomainTransfer: false,
				enablePromptEvolution: false,
			},
		});

		const result = await loop.run(
			{ description: "test", maxIterations: 10 },
			"excluded.com",
		);

		// ExperimentRunner should skip → empty experiments
		expect(result.experiments.length).toBe(0);
	});

	it("can run multiple cycles accumulating journal data", async () => {
		const loopFactory = async () => ({
			run: async () => makeResult(),
		}) as any;

		const loop = new AutoResearchLoop(loopFactory, {
			config: {
				researchDir: tmpDir,
				persistToDisk: false,
				enableCrossDomainTransfer: false,
				enablePromptEvolution: false,
			},
		});

		await loop.run({ description: "cycle 1", maxIterations: 10 }, "a.com");
		await loop.run({ description: "cycle 2", maxIterations: 10 }, "b.com");

		const journal = loop.getJournal();
		expect(journal.size).toBeGreaterThan(0);
	});
});

function makeResult() {
	return {
		status: "completed" as const,
		goal: { description: "test", maxIterations: 10 },
		totalIterations: 5, totalDurationMs: 1000, totalCostUsd: 0.01,
		createdSkills: [], stopReason: "goal-achieved" as const,
	};
}
