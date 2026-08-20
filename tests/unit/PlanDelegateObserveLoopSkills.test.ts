import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTask, CoordinatorResult } from "../../src/core/AgentCoordinator.js";
import {
	type CoordinationRuntime,
	PlanDelegateObserveLoop,
} from "../../src/core/loop/PlanDelegateObserveLoop.js";
import type { Planner } from "../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../src/core/loop/types.js";

function coordinatorResult(
	url = "https://example.com/",
	title = "Example",
	results: CoordinatorResult["results"] = [],
): CoordinatorResult {
	return {
		results,
		states: [
			{
				url,
				title,
				timestamp: new Date().toISOString(),
				interactiveElements: [],
				consoleErrors: [],
				bugs: [],
			} as CoordinatorResult["states"][number],
		],
		sharedState: {},
		conflicts: [],
		totalDurationMs: 1,
	};
}

function runtimeWithResults(results: CoordinatorResult[]): CoordinationRuntime {
	let call = 0;
	return {
		agentCount: 1,
		async run(_tasks: AgentTask[]): Promise<CoordinatorResult> {
			const result = results[Math.min(call, results.length - 1)];
			call += 1;
			if (!result) throw new Error("missing synthetic coordinator result");
			return result;
		},
		getSharedState() {
			return {};
		},
	};
}

describe("PlanDelegateObserveLoop skills and callbacks", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("loads matching domain skills into planner context", async () => {
		const skillsDir = mkdtempSync(path.join(tmpdir(), "talox-coordination-skills-"));
		tempDirs.push(skillsDir);
		const skillDir = path.join(skillsDir, "example-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			path.join(skillDir, "SKILL.md"),
			`---\nname: example-skill\ndescription: Example domain strategy\nversion: 1.0\ndomain: example.com\n---\n\nUse the magic button when example.com is open.\n`,
			"utf-8",
		);

		const inputs: PlannerInput[] = [];
		const planner: Planner = {
			async plan(input): Promise<TaskPlan> {
				inputs.push(input);
				return { assessment: "done", steps: [], goalAchieved: true };
			},
		};

		const loop = new PlanDelegateObserveLoop(runtimeWithResults([coordinatorResult()]), {
			goal: { description: "Use domain knowledge", maxIterations: 1 },
			planner: { model: "test-model" },
			plannerOverride: planner,
			skillsDir,
		});

		const result = await loop.run();

		expect(result.status).toBe("completed");
		expect(inputs).toHaveLength(1);
		expect(inputs[0]?.skillsContext).toContain("example-skill");
		expect(inputs[0]?.skillsContext).toContain("Use the magic button");
	});

	it("does not fail the coordination run when onProgress throws", async () => {
		let plannerCall = 0;
		const planner: Planner = {
			async plan(): Promise<TaskPlan> {
				plannerCall += 1;
				if (plannerCall === 1) {
					return {
						assessment: "observe once",
						goalAchieved: false,
						steps: [
							{
								index: 0,
								action: "Observe",
								tool: "getState",
								args: { agentId: 0 },
								reasoning: "collect final state",
								retryable: false,
							},
						],
					};
				}
				return { assessment: "done", steps: [], goalAchieved: true };
			},
		};

		const task: AgentTask = { agentId: 0, action: "getState" };
		const runtime = runtimeWithResults([
			coordinatorResult(),
			coordinatorResult("https://example.com/final", "Final", [
				{ agentId: 0, task, success: true, data: {}, durationMs: 1 },
			]),
		]);
		const onProgress = vi.fn(() => {
			throw new Error("observer exploded");
		});

		const loop = new PlanDelegateObserveLoop(runtime, {
			goal: { description: "Ignore observer errors", maxIterations: 2 },
			planner: { model: "test-model" },
			plannerOverride: planner,
			onProgress,
		});

		const result = await loop.run();

		expect(onProgress).toHaveBeenCalledOnce();
		expect(result.status).toBe("completed");
		expect(result.stopReason).toBe("goal-achieved");
		expect(result.totalWaves).toBe(1);
	});
});
