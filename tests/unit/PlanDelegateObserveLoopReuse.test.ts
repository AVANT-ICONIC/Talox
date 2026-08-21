import { describe, expect, it } from "vitest";
import type { AgentResult, AgentTask, CoordinatorResult } from "../../src/core/AgentCoordinator.js";
import {
	PlanDelegateObserveLoop,
	type CoordinationRuntime,
} from "../../src/core/loop/PlanDelegateObserveLoop.js";
import type { Planner } from "../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../src/core/loop/types.js";

function state(url: string): NonNullable<CoordinatorResult["states"][number]> {
	return { url, title: url, timestamp: new Date().toISOString() } as NonNullable<CoordinatorResult["states"][number]>;
}

class Runtime implements CoordinationRuntime {
	readonly agentCount = 1;
	readonly calls: AgentTask[][] = [];
	private currentState = state("about:blank");

	async run(tasks: AgentTask[]): Promise<CoordinatorResult> {
		this.calls.push(tasks);
		const results: AgentResult[] = tasks.map((task) => {
			const url = task.params?.["url"];
			if (task.action === "navigate" && typeof url === "string") this.currentState = state(url);
			return { agentId: 0, task, success: true, data: this.currentState, durationMs: 1 };
		});
		return {
			results,
			states: [this.currentState],
			sharedState: {},
			conflicts: [],
			totalDurationMs: 1,
		};
	}

	getSharedState(): Readonly<Record<string, unknown>> {
		return {};
	}
}

class SequencePlanner implements Planner {
	readonly inputs: PlannerInput[] = [];
	private index = 0;

	constructor(private readonly plans: TaskPlan[]) {}

	async plan(input: PlannerInput): Promise<TaskPlan> {
		this.inputs.push(input);
		const plan = this.plans[this.index++];
		if (!plan) throw new Error("Missing test plan");
		return plan;
	}
}

function navigatePlan(url: string): TaskPlan {
	return {
		assessment: `navigate ${url}`,
		goalAchieved: false,
		steps: [
			{
				index: 0,
				action: "navigate",
				tool: "navigate",
				args: { agentId: 0, url },
				reasoning: "test",
				retryable: true,
			},
		],
	};
}

const completePlan: TaskPlan = {
	assessment: "done",
	steps: [],
	goalAchieved: true,
};

describe("PlanDelegateObserveLoop reuse", () => {
	it("starts each run with an empty coordination-wave history", async () => {
		const runtime = new Runtime();
		const planner = new SequencePlanner([
			navigatePlan("https://first.example"),
			completePlan,
			navigatePlan("https://second.example"),
			completePlan,
		]);
		const loop = new PlanDelegateObserveLoop(runtime, {
			goal: { description: "reuse", maxIterations: 2 },
			planner: { model: "test" },
			plannerOverride: planner,
		});

		const first = await loop.run();
		const second = await loop.run();

		expect(first.totalWaves).toBe(1);
		expect(second.totalWaves).toBe(1);
		expect(loop.getWaves()).toHaveLength(1);
		expect(runtime.calls).toHaveLength(4); // two bootstraps + two delegated waves
		expect(planner.inputs[2]?.multiAgent?.recentWaves).toEqual([]);
	});
});
