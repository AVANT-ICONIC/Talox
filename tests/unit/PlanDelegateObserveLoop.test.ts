import { describe, expect, it } from "vitest";
import type { AgentResult, AgentTask, CoordinatorResult } from "../../src/core/AgentCoordinator.js";
import type { CoordinationRuntime, PlanDelegateObserveOptions } from "../../src/core/loop/PlanDelegateObserveLoop.js";
import { PlanDelegateObserveLoop } from "../../src/core/loop/PlanDelegateObserveLoop.js";
import type { Planner } from "../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../src/core/loop/types.js";

function makeState(url: string, title: string): NonNullable<CoordinatorResult["states"][number]> {
	return { url, title } as NonNullable<CoordinatorResult["states"][number]>;
}

class FakeRuntime implements CoordinationRuntime {
	readonly calls: AgentTask[][] = [];
	readonly agentCount: number;
	private readonly states: Array<NonNullable<CoordinatorResult["states"][number]>>;
	private shared: Record<string, unknown> = {};

	constructor(agentCount: number) {
		this.agentCount = agentCount;
		this.states = Array.from({ length: agentCount }, (_, id) => makeState("about:blank", `Agent ${id}`));
	}

	async run(tasks: AgentTask[]): Promise<CoordinatorResult> {
		this.calls.push(
			tasks.map((task) => {
				const clone: AgentTask = { ...task };
				if (task.params) clone.params = { ...task.params };
				return clone;
			}),
		);

		const results: AgentResult[] = [];
		for (const task of tasks) {
			if (task.action === "navigate") {
				const url = task.params?.["url"];
				if (typeof url === "string") this.states[task.agentId] = makeState(url, `Page ${task.agentId}`);
			}

			const data = this.states[task.agentId];
			const result: AgentResult = {
				agentId: task.agentId,
				task,
				success: true,
				data,
				durationMs: 1,
			};
			if (task.resultKey) {
				this.shared[task.resultKey] = data;
				result.mergedToSharedState = true;
			}
			results.push(result);
		}

		return {
			results,
			states: [...this.states],
			sharedState: Object.freeze({ ...this.shared }),
			conflicts: [],
			totalDurationMs: 1,
		};
	}

	getSharedState(): Readonly<Record<string, unknown>> {
		return Object.freeze({ ...this.shared });
	}
}

class SequencePlanner implements Planner {
	readonly inputs: PlannerInput[] = [];
	private index = 0;

	constructor(private readonly plans: TaskPlan[]) {}

	async plan(input: PlannerInput): Promise<TaskPlan> {
		this.inputs.push(input);
		const plan = this.plans[this.index] ?? this.plans[this.plans.length - 1];
		this.index += 1;
		if (!plan) throw new Error("No planner result configured");
		return plan;
	}
}

function options(
	plannerOverride: Planner,
	extra: Partial<PlanDelegateObserveOptions> = {},
): PlanDelegateObserveOptions {
	return {
		goal: {
			description: "Compare two sites",
			maxIterations: 3,
		},
		planner: { model: "test-model" },
		plannerOverride,
		...extra,
	};
}

function taskPlan(steps: TaskPlan["steps"], goalAchieved = false): TaskPlan {
	return {
		assessment: goalAchieved ? "Goal complete" : "Delegate next wave",
		steps,
		goalAchieved,
	};
}

describe("PlanDelegateObserveLoop", () => {
	it("plans, delegates in parallel, observes, and replans until the goal is achieved", async () => {
		const runtime = new FakeRuntime(2);
		const planner = new SequencePlanner([
			taskPlan([
				{
					index: 0,
					action: "Open source A",
					tool: "navigate",
					args: { agentId: 0, url: "https://a.example", resultKey: "sourceA" },
					reasoning: "Research A",
					retryable: true,
				},
				{
					index: 1,
					action: "Open source B",
					tool: "navigate",
					args: { agentId: 1, url: "https://b.example", resultKey: "sourceB" },
					reasoning: "Research B",
					retryable: true,
				},
			]),
			taskPlan([], true),
		]);

		const loop = new PlanDelegateObserveLoop(runtime, options(planner));
		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalWaves).toBe(1);
		expect(runtime.calls).toHaveLength(2); // bootstrap + delegated wave
		expect(runtime.calls[1]?.map((task) => task.agentId)).toEqual([0, 1]);
		expect(runtime.calls[1]?.map((task) => task.resultKey)).toEqual(["sourceA", "sourceB"]);
		expect(planner.inputs[0]?.multiAgent?.agentCount).toBe(2);
		expect(planner.inputs[1]?.multiAgent?.recentWaves).toHaveLength(1);
		expect(result.sharedState).toHaveProperty("sourceA");
		expect(result.sharedState).toHaveProperty("sourceB");
	});

	it("falls back to deterministic round-robin assignment and normalizes tool aliases", async () => {
		const runtime = new FakeRuntime(2);
		const planner = new SequencePlanner([
			taskPlan([
				{
					index: 0,
					action: "Open",
					tool: "open",
					args: { url: "https://a.example" },
					reasoning: "No explicit agent",
					retryable: true,
				},
				{
					index: 1,
					action: "Fill",
					tool: "fill",
					args: { agentId: 99, selector: "#q", text: "hello" },
					reasoning: "Invalid agent falls back",
					retryable: true,
				},
				{
					index: 2,
					action: "Wait",
					tool: "waitForTimeout",
					args: { agentId: 1, ms: 250 },
					reasoning: "Pause",
					retryable: true,
				},
			]),
			taskPlan([], true),
		]);

		const result = await new PlanDelegateObserveLoop(runtime, options(planner)).run();
		const delegated = runtime.calls[1] ?? [];

		expect(result.status).toBe("completed");
		expect(delegated.map((task) => task.agentId)).toEqual([0, 1, 1]);
		expect(delegated.map((task) => task.action)).toEqual(["navigate", "type", "wait"]);
		expect(delegated[0]?.params).toEqual({ url: "https://a.example" });
		expect(delegated[1]?.params).toEqual({ selector: "#q", text: "hello" });
	});

	it("uses the start URL to bootstrap every browser agent", async () => {
		const runtime = new FakeRuntime(3);
		const planner = new SequencePlanner([taskPlan([], true)]);
		const opts = options(planner);
		opts.goal.startUrl = "https://start.example";

		await new PlanDelegateObserveLoop(runtime, opts).run();

		expect(runtime.calls).toHaveLength(1);
		expect(runtime.calls[0]).toHaveLength(3);
		for (const task of runtime.calls[0] ?? []) {
			expect(task.action).toBe("navigate");
			expect(task.params?.["url"]).toBe("https://start.example");
		}
	});

	it("fails cleanly when the planner returns only unsupported tools", async () => {
		const runtime = new FakeRuntime(2);
		const planner = new SequencePlanner([
			taskPlan([
				{
					index: 0,
					action: "Do magic",
					tool: "unsupportedMagic",
					args: { agentId: 0 },
					reasoning: "Not executable",
					retryable: false,
				},
			]),
		]);

		const result = await new PlanDelegateObserveLoop(runtime, options(planner)).run();

		expect(result.status).toBe("failed");
		expect(result.stopReason).toBe("no-executable-steps");
		expect(runtime.calls).toHaveLength(1); // bootstrap only
	});

	it("stops before delegation on an unresolvable blocker", async () => {
		const runtime = new FakeRuntime(2);
		const blocked: TaskPlan = {
			assessment: "Human login required",
			steps: [],
			goalAchieved: false,
			blocker: {
				type: "login-wall",
				confidence: 1,
				description: "Login required",
				evidence: ["sign in"],
				autoResolvable: false,
			},
		};
		const planner = new SequencePlanner([blocked]);

		const result = await new PlanDelegateObserveLoop(runtime, options(planner)).run();

		expect(result.stopReason).toBe("unresolvable-blocker");
		expect(runtime.calls).toHaveLength(1);
	});

	it("performs a final read-only verification after the execution budget is exhausted", async () => {
		const runtime = new FakeRuntime(1);
		const planner = new SequencePlanner([
			taskPlan([
				{
					index: 0,
					action: "Open target",
					tool: "navigate",
					args: { agentId: 0, url: "https://done.example" },
					reasoning: "Final action",
					retryable: true,
				},
			]),
			taskPlan([], true),
		]);

		const result = await new PlanDelegateObserveLoop(runtime, options(planner, { maxWaves: 1 })).run();

		expect(result.status).toBe("completed");
		expect(result.totalWaves).toBe(1);
		expect(planner.inputs).toHaveLength(2);
		expect(runtime.calls).toHaveLength(2);
	});
});
