import { describe, expect, it } from "vitest";
import type { AgentTask, CoordinatorResult } from "../../src/core/AgentCoordinator.js";
import { type CoordinationRuntime, PlanDelegateObserveLoop } from "../../src/core/loop/PlanDelegateObserveLoop.js";
import type { Planner } from "../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../src/core/loop/types.js";

function observation(): CoordinatorResult {
	return {
		results: [],
		states: [{ url: "https://example.com", title: "Example" } as CoordinatorResult["states"][number]],
		sharedState: Object.freeze({}),
		conflicts: [],
		totalDurationMs: 1,
	};
}

class ThrowingRuntime implements CoordinationRuntime {
	readonly agentCount = 1;
	calls = 0;

	constructor(private readonly throwOnCall: number) {}

	async run(_tasks: AgentTask[]): Promise<CoordinatorResult> {
		this.calls += 1;
		if (this.calls === this.throwOnCall) throw new Error(`runtime boom ${this.calls}`);
		return observation();
	}

	getSharedState(): Readonly<Record<string, unknown>> {
		return Object.freeze({});
	}
}

class FixedPlanner implements Planner {
	constructor(private readonly value: TaskPlan | Error) {}

	async plan(_input: PlannerInput): Promise<TaskPlan> {
		if (this.value instanceof Error) throw this.value;
		return this.value;
	}
}

function loop(runtime: CoordinationRuntime, planner: Planner): PlanDelegateObserveLoop {
	return new PlanDelegateObserveLoop(runtime, {
		goal: { description: "Test failure paths", maxIterations: 2 },
		planner: { model: "test" },
		plannerOverride: planner,
	});
}

describe("PlanDelegateObserveLoop failure handling", () => {
	it("reports bootstrap failures without throwing", async () => {
		const runtime = new ThrowingRuntime(1);
		const result = await loop(runtime, new FixedPlanner(new Error("unused"))).run();

		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("bootstrap-failed");
		expect(result.error).toBe("runtime boom 1");
	});

	it("reports planner failures without delegating another wave", async () => {
		const runtime = new ThrowingRuntime(99);
		const result = await loop(runtime, new FixedPlanner(new Error("planner boom"))).run();

		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("planner-error");
		expect(result.error).toBe("planner boom");
		expect(runtime.calls).toBe(1); // bootstrap only
	});

	it("reports execution failures after a successful planning pass", async () => {
		const runtime = new ThrowingRuntime(2);
		const planner = new FixedPlanner({
			assessment: "Navigate",
			goalAchieved: false,
			steps: [
				{
					index: 0,
					action: "Navigate",
					tool: "navigate",
					args: { url: "https://target.example" },
					reasoning: "Test",
					retryable: true,
				},
			],
		});
		const result = await loop(runtime, planner).run();

		expect(result.stopReason).toBe("execution-error");
		expect(result.error).toBe("runtime boom 2");
		expect(runtime.calls).toBe(2);
	});

	it("ignores malformed planner entries instead of throwing", async () => {
		const runtime = new ThrowingRuntime(99);
		const malformed = {
			assessment: "Malformed output",
			goalAchieved: false,
			steps: ["garbage", null, { nope: true }],
		} as unknown as TaskPlan;
		const result = await loop(runtime, new FixedPlanner(malformed)).run();

		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("no-executable-steps");
		expect(runtime.calls).toBe(1);
	});

	it("normalizes missing step args and deterministically assigns an agent", async () => {
		const calls: AgentTask[][] = [];
		const runtime: CoordinationRuntime = {
			agentCount: 2,
			async run(tasks) {
				calls.push(tasks);
				return {
					results: tasks.map((task) => ({ agentId: task.agentId, task, success: true, durationMs: 1 })),
					states: [
						{ url: "https://a.example", title: "A" } as CoordinatorResult["states"][number],
						{ url: "https://b.example", title: "B" } as CoordinatorResult["states"][number],
					],
					sharedState: Object.freeze({}),
					conflicts: [],
					totalDurationMs: 1,
				};
			},
			getSharedState: () => Object.freeze({}),
		};

		let planningCalls = 0;
		const planner: Planner = {
			async plan() {
				planningCalls += 1;
				if (planningCalls > 1) return { assessment: "done", steps: [], goalAchieved: true };
				return {
					assessment: "recover",
					goalAchieved: false,
					steps: [{ tool: "getState" }] as unknown as TaskPlan["steps"],
				};
			},
		};

		const result = await loop(runtime, planner).run();
		expect(result.status).toBe("completed");
		expect(calls[1]).toEqual([{ agentId: 0, action: "getState" }]);
	});
});
