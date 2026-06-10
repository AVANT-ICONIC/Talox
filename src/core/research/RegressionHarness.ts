/**
 * @file RegressionHarness.ts
 * @description Regression testing for research outcomes — ensures that
 * strategy promotions and skill changes don't break existing capabilities.
 *
 * Maintains a suite of regression test cases with baseline metrics.
 * After any research change, runs the suite and reports regressions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AutonomousLoop } from "../loop/AutonomousLoop.js";
import type { TaskGoal } from "../loop/types.js";
import type { AutoResearchConfig, RegressionResult, RegressionTestCase, RunMetrics } from "./types.js";

// ─── RegressionHarness ────────────────────────────────────────────────────

export class RegressionHarness {
	private readonly config: AutoResearchConfig;
	private readonly persistPath: string;
	private testCases: RegressionTestCase[] = [];

	constructor(config: AutoResearchConfig) {
		this.config = config;
		this.persistPath = join(config.researchDir, "regression-suite.json");
	}

	/**
	 * Load regression test suite from disk.
	 */
	async load(): Promise<void> {
		try {
			const raw = await readFile(this.persistPath, "utf-8");
			this.testCases = JSON.parse(raw) as RegressionTestCase[];
		} catch {
			this.testCases = [];
		}
	}

	/**
	 * Save current test suite to disk.
	 */
	async save(): Promise<void> {
		await mkdir(join(this.persistPath, ".."), { recursive: true });
		await writeFile(this.persistPath, JSON.stringify(this.testCases, null, 2), "utf-8");
	}

	/**
	 * Add a regression test case.
	 */
	addTestCase(
		testCase: Omit<RegressionTestCase, "id" | "lastRunMetrics" | "lastRunTimestamp" | "status">,
	): RegressionTestCase {
		const tc: RegressionTestCase = {
			...testCase,
			id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			lastRunMetrics: null,
			lastRunTimestamp: null,
			status: "unknown",
		};
		this.testCases.push(tc);
		return tc;
	}

	/**
	 * Remove a test case by ID.
	 */
	removeTestCase(id: string): boolean {
		const idx = this.testCases.findIndex((tc) => tc.id === id);
		if (idx === -1) return false;
		this.testCases.splice(idx, 1);
		return true;
	}

	/**
	 * Run the full regression suite. Returns results for all test cases.
	 */
	async runSuite(
		loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>,
	): Promise<RegressionResult[]> {
		const results: RegressionResult[] = [];

		for (const tc of this.testCases) {
			const result = await this.runSingle(tc, loopFactory);
			results.push(result);
		}

		return results;
	}

	/**
	 * Run a single regression test case.
	 */
	async runSingle(
		testCase: RegressionTestCase,
		loopFactory: (params: Record<string, unknown>) => Promise<AutonomousLoop>,
	): Promise<RegressionResult> {
		const regressions: string[] = [];

		try {
			const loop = await loopFactory({});

			const startTime = Date.now();
			const result = await loop.run();
			const duration = Date.now() - startTime;

			const metrics: RunMetrics = {
				iterationsToGoal: result.totalIterations,
				totalDurationMs: duration,
				totalCostUsd: result.totalCostUsd,
				blockerCount: 0,
				blockerTypes: [],
				goalAchieved: result.status === "completed",
				skillsCreated: result.createdSkills.length,
				strategySuccessRate: result.status === "completed" ? 1 : 0,
			};

			// Check for regressions
			if (metrics.iterationsToGoal > testCase.expectedMaxIterations) {
				regressions.push(`Iterations ${metrics.iterationsToGoal} exceeds max ${testCase.expectedMaxIterations}`);
			}
			if (metrics.totalDurationMs > testCase.expectedMaxDurationMs) {
				regressions.push(`Duration ${metrics.totalDurationMs}ms exceeds max ${testCase.expectedMaxDurationMs}ms`);
			}
			if (!metrics.goalAchieved) {
				regressions.push("Goal not achieved");
			}

			// Compare with previous run if available
			if (testCase.lastRunMetrics) {
				if (metrics.iterationsToGoal > testCase.lastRunMetrics.iterationsToGoal * 1.5) {
					regressions.push(
						`Iterations regressed from ${testCase.lastRunMetrics.iterationsToGoal} to ${metrics.iterationsToGoal}`,
					);
				}
				if (testCase.lastRunMetrics.goalAchieved && !metrics.goalAchieved) {
					regressions.push("Previously passing goal now fails");
				}
			}

			// Update test case
			testCase.lastRunMetrics = metrics;
			testCase.lastRunTimestamp = new Date().toISOString();
			testCase.status = regressions.length === 0 ? "passing" : "failing";

			return {
				testCaseId: testCase.id,
				passed: regressions.length === 0,
				metrics,
				regressions,
				timestamp: new Date().toISOString(),
			};
		} catch (err) {
			testCase.status = "failing";
			return {
				testCaseId: testCase.id,
				passed: false,
				metrics: {
					iterationsToGoal: 0,
					totalDurationMs: 0,
					totalCostUsd: 0,
					blockerCount: 0,
					blockerTypes: [],
					goalAchieved: false,
					skillsCreated: 0,
					strategySuccessRate: 0,
				},
				regressions: [`Test execution failed: ${err}`],
				timestamp: new Date().toISOString(),
			};
		}
	}

	/**
	 * Get all test cases.
	 */
	getTestCases(): RegressionTestCase[] {
		return [...this.testCases];
	}

	/**
	 * Get failing test cases.
	 */
	getFailingTests(): RegressionTestCase[] {
		return this.testCases.filter((tc) => tc.status === "failing");
	}

	/**
	 * Get passing test cases.
	 */
	getPassingTests(): RegressionTestCase[] {
		return this.testCases.filter((tc) => tc.status === "passing");
	}
}
