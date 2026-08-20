/**
 * @file PlanDelegateObserveLoop.integration.test.ts
 * @description Browser-backed two-agent integration coverage for coordinated planning.
 */

import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentCoordinator } from "../../../src/core/AgentCoordinator.js";
import { PlanDelegateObserveLoop } from "../../../src/core/loop/PlanDelegateObserveLoop.js";
import type { Planner } from "../../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../../src/core/loop/types.js";

function dataUri(html: string): string {
	return `data:text/html,${encodeURIComponent(html)}`;
}

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

function page(title: string, doneTitle: string): string {
	return dataUri(`<!doctype html>
<html>
<head><title>${title}</title></head>
<body>
	<button id="mark" onclick="document.title='${doneTitle}'">mark done</button>
</body>
</html>`);
}

describe("PlanDelegateObserveLoop integration", () => {
	let coordinator: AgentCoordinator;
	let browserAvailable = true;

	beforeAll(async () => {
		coordinator = new AgentCoordinator({
			agents: 2,
			baseDir: path.join(__dirname, "../../temp-profiles/multi-agent-loop"),
			settings: { headed: false, verbosity: 0 },
		});

		try {
			await coordinator.launch({ profileClass: "sandbox", headed: false });
		} catch (error) {
			await coordinator.stop();
			if (isMissingBrowserError(error)) {
				browserAvailable = false;
				return;
			}
			throw error;
		}
	});

	afterAll(async () => {
		await coordinator.stop();
	});

	it("replans across two real browser agents and preserves isolated page state", async () => {
		if (!browserAvailable) return;

		const agentAPage = page("agent-a", "agent-a-done");
		const agentBPage = page("agent-b", "agent-b-done");
		const observations: PlannerInput[] = [];
		let plannerCall = 0;

		const planner: Planner = {
			async plan(input): Promise<TaskPlan> {
				observations.push(input);
				plannerCall += 1;

				if (plannerCall === 1) {
					return {
						assessment: "Split independent navigation across both agents",
						goalAchieved: false,
						steps: [
							{
								index: 0,
								action: "Open agent A page",
								tool: "navigate",
								args: { agentId: 0, url: agentAPage, resultKey: "agentA" },
								reasoning: "independent branch A",
								retryable: true,
							},
							{
								index: 1,
								action: "Open agent B page",
								tool: "navigate",
								args: { agentId: 1, url: agentBPage, resultKey: "agentB" },
								reasoning: "independent branch B",
								retryable: true,
							},
						],
					};
				}

				if (plannerCall === 2) {
					expect(input.multiAgent?.agents[0]?.title).toBe("agent-a");
					expect(input.multiAgent?.agents[1]?.title).toBe("agent-b");
					expect(input.multiAgent?.sharedState).toHaveProperty("agentA");
					expect(input.multiAgent?.sharedState).toHaveProperty("agentB");

					return {
						assessment: "Both independent pages loaded; interact with each in parallel",
						goalAchieved: false,
						steps: [
							{
								index: 0,
								action: "Mark A complete",
								tool: "click",
								args: { agentId: 0, selector: "#mark" },
								reasoning: "complete branch A",
								retryable: true,
							},
							{
								index: 1,
								action: "Mark B complete",
								tool: "click",
								args: { agentId: 1, selector: "#mark" },
								reasoning: "complete branch B",
								retryable: true,
							},
						],
					};
				}

				expect(input.multiAgent?.agents[0]?.title).toBe("agent-a-done");
				expect(input.multiAgent?.agents[1]?.title).toBe("agent-b-done");
				return {
					assessment: "Both browser branches completed",
					goalAchieved: true,
					steps: [],
				};
			},
		};

		const loop = new PlanDelegateObserveLoop(coordinator, {
			goal: {
				description: "Complete two independent browser branches",
				startUrl: dataUri("<html><head><title>start</title></head><body>start</body></html>"),
				maxIterations: 2,
			},
			planner: { model: "test-model" },
			plannerOverride: planner,
			maxWaves: 2,
		});

		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalWaves).toBe(2);
		expect(result.sharedState).toHaveProperty("agentA");
		expect(result.sharedState).toHaveProperty("agentB");
		expect(observations).toHaveLength(3);
	});
});
