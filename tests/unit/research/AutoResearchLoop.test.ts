import { describe, it, expect, beforeEach, vi } from "vitest";
import { AutoResearchLoop, DEFAULT_RESEARCH_CONFIG } from "../../../src/core/research/AutoResearchLoop.js";
import type { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { LoopResult } from "../../../src/core/loop/types.js";

function makeLoopResult(overrides: Partial<LoopResult> = {}): LoopResult {
	return {
		status: "completed",
		goal: { description: "test goal", maxIterations: 10 },
		totalIterations: 3,
		totalDurationMs: 500,
		totalCostUsd: 0.01,
		createdSkills: [],
		stopReason: "goal-achieved",
		...overrides,
	};
}

describe("AutoResearchLoop", () => {
	let loop: AutoResearchLoop;
	let mockLoopFactory: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		const mockLoop = { run: vi.fn().mockResolvedValue(makeLoopResult()) } as unknown as AutonomousLoop;
		mockLoopFactory = vi.fn().mockResolvedValue(mockLoop);

		loop = new AutoResearchLoop(mockLoopFactory, {
			config: {
				persistToDisk: false,
				researchDir: `/tmp/talox-test-research-${Date.now()}`,
				enableCrossDomainTransfer: false,
				enablePromptEvolution: false,
			},
		});
	});

	it("initializes without error", async () => {
		await loop.initialize();
		expect(true).toBe(true);
	});

	it("runs a full research cycle", async () => {
		const goal = { description: "navigate to login page", maxIterations: 10 };
		const result = await loop.run(goal, "example.com");

		expect(result).toBeDefined();
		expect(result.experiments).toBeDefined();
		expect(result.evaluations).toBeDefined();
		expect(result.promotions).toBeDefined();
		expect(result.journal).toBeDefined();
	});

	it("default config has sensible values", () => {
		expect(DEFAULT_RESEARCH_CONFIG.runsPerVariant).toBe(3);
		expect(DEFAULT_RESEARCH_CONFIG.promotionThreshold).toBe(0.15);
		expect(DEFAULT_RESEARCH_CONFIG.regressionTimeoutMs).toBe(60_000);
		expect(DEFAULT_RESEARCH_CONFIG.maxSkillVersions).toBe(10);
	});

	it("exposes journal getter", async () => {
		await loop.initialize();
		expect(loop.getJournal()).toBeDefined();
	});

	it("exposes priority getter", () => {
		expect(loop.getPriority()).toBeDefined();
	});

	it("exposes composer getter", () => {
		expect(loop.getComposer()).toBeDefined();
	});

	it("generateReport delegates to reporter", async () => {
		await loop.initialize();
		const report = loop.generateReport({ from: "2026-01-01", to: "2026-12-31" });
		expect(report).toBeDefined();
		expect(report.id).toMatch(/^report_/);
	});

	it("initialize is idempotent", async () => {
		await loop.initialize();
		await loop.initialize(); // Should not throw
	});

	it("handles loop factory failure gracefully", async () => {
		const failFactory = vi.fn().mockRejectedValue(new Error("factory failed"));
		const failLoop = new AutoResearchLoop(failFactory, {
			config: { persistToDisk: false, researchDir: `/tmp/talox-test-fail-${Date.now()}`, enableCrossDomainTransfer: false, enablePromptEvolution: false },
		});

		const goal = { description: "test", maxIterations: 10 };
		// The experiment runner catches loop errors per arm, so this shouldn't throw
		const result = await failLoop.run(goal, "example.com");
		expect(result).toBeDefined();
	});
});
