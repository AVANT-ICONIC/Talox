import type {
	AgentResult,
	AgentTask,
	CoordinatorResult,
	SharedStateConflictStrategy,
} from "../AgentCoordinator.js";
import { LLMPlanner, type Planner } from "./Planner.js";
import type {
	MultiAgentPlannerAgentState,
	MultiAgentPlannerConflict,
	MultiAgentPlannerContext,
	MultiAgentPlannerWaveSummary,
	PlannerConfig,
	PlannerInput,
	TaskGoal,
	TaskPlan,
} from "./types.js";

export interface CoordinationRuntime {
	readonly agentCount: number;
	run(tasks: AgentTask[]): Promise<CoordinatorResult>;
	getSharedState(): Readonly<Record<string, unknown>>;
}

export interface PlanDelegateObserveOptions {
	goal: TaskGoal;
	planner: PlannerConfig;
	/** Override the internally-created planner. Intended for tests or custom planners. */
	plannerOverride?: Planner;
	/** Maximum execution waves. Defaults to goal.maxIterations. */
	maxWaves?: number;
	/** Called after each executed coordination wave. */
	onProgress?: (wave: CoordinationWave) => void;
}

export interface CoordinationWave {
	wave: number;
	plan: TaskPlan;
	tasks: AgentTask[];
	result: CoordinatorResult;
	timestamp: string;
}

export type CoordinationStopReason =
	| "goal-achieved"
	| "max-waves"
	| "planner-stalled"
	| "unresolvable-blocker"
	| "no-executable-steps"
	| "bootstrap-failed";

export interface PlanDelegateObserveResult {
	status: "completed" | "failed";
	stopReason: CoordinationStopReason;
	goal: TaskGoal;
	waves: CoordinationWave[];
	totalWaves: number;
	totalDurationMs: number;
	sharedState: Readonly<Record<string, unknown>>;
	finalPlan?: TaskPlan;
}

const SUPPORTED_ACTIONS = new Set<AgentTask["action"]>(["navigate", "click", "type", "getState", "screenshot", "wait"]);
const CONFLICT_STRATEGIES = new Set<SharedStateConflictStrategy>(["first-write-wins", "last-write-wins", "reject"]);

/**
 * Multi-agent coordination loop for Talox.
 *
 * Each cycle is explicit and inspectable:
 * observe all browser agents -> plan a parallel wave -> delegate through
 * AgentCoordinator -> merge shared state -> observe fresh states -> replan.
 */
export class PlanDelegateObserveLoop {
	private readonly runtime: CoordinationRuntime;
	private readonly planner: Planner;
	private readonly options: PlanDelegateObserveOptions;
	private readonly maxWaves: number;
	private readonly waves: CoordinationWave[] = [];

	constructor(runtime: CoordinationRuntime, options: PlanDelegateObserveOptions) {
		if (runtime.agentCount < 1) throw new Error("PlanDelegateObserveLoop requires at least one agent");

		this.runtime = runtime;
		this.options = options;
		this.maxWaves = Math.max(1, options.maxWaves ?? options.goal.maxIterations);
		this.planner = options.plannerOverride ?? new LLMPlanner(options.planner);
	}

	async run(): Promise<PlanDelegateObserveResult> {
		const startTime = Date.now();
		let observation: CoordinatorResult;

		try {
			observation = await this.bootstrap();
		} catch {
			return this.buildResult("failed", "bootstrap-failed", startTime);
		}

		for (let waveNumber = 1; waveNumber <= this.maxWaves; waveNumber++) {
			const plan = await this.planNextWave(observation, waveNumber);

			if (plan.goalAchieved) {
				return this.buildResult("completed", "goal-achieved", startTime, plan);
			}

			if (plan.blocker && !plan.blocker.autoResolvable) {
				return this.buildResult("failed", "unresolvable-blocker", startTime, plan);
			}

			const tasks = this.toAgentTasks(plan);
			if (tasks.length === 0) {
				const reason: CoordinationStopReason = plan.steps.length === 0 ? "planner-stalled" : "no-executable-steps";
				return this.buildResult("failed", reason, startTime, plan);
			}

			observation = await this.runtime.run(tasks);
			const wave: CoordinationWave = {
				wave: waveNumber,
				plan,
				tasks,
				result: observation,
				timestamp: new Date().toISOString(),
			};
			this.waves.push(wave);
			this.options.onProgress?.(wave);
		}

		// One read-only verification pass after the final execution wave. This
		// avoids reporting max-waves when the last delegated action actually
		// completed the goal.
		const finalPlan = await this.planNextWave(observation, this.maxWaves + 1);
		if (finalPlan.goalAchieved) {
			return this.buildResult("completed", "goal-achieved", startTime, finalPlan);
		}

		return this.buildResult("failed", "max-waves", startTime, finalPlan);
	}

	getWaves(): CoordinationWave[] {
		return [...this.waves];
	}

	private async bootstrap(): Promise<CoordinatorResult> {
		const tasks: AgentTask[] = Array.from({ length: this.runtime.agentCount }, (_, agentId) => {
			if (this.options.goal.startUrl) {
				return {
					agentId,
					action: "navigate",
					params: { url: this.options.goal.startUrl },
				};
			}
			return { agentId, action: "getState" };
		});

		return this.runtime.run(tasks);
	}

	private async planNextWave(observation: CoordinatorResult, waveNumber: number): Promise<TaskPlan> {
		const state = this.selectPrimaryState(observation);
		const input: PlannerInput = {
			state,
			goal: this.options.goal,
			recentIterations: [],
			skillsContext: "",
			multiAgent: this.buildPlannerContext(observation, waveNumber),
		};
		return this.planner.plan(input);
	}

	private selectPrimaryState(observation: CoordinatorResult): PlannerInput["state"] {
		const state = observation.states.find((candidate) => candidate !== null);
		if (!state) throw new Error("Coordinator returned no observable browser state");
		return state as unknown as PlannerInput["state"];
	}

	private buildPlannerContext(observation: CoordinatorResult, waveNumber: number): MultiAgentPlannerContext {
		return {
			agentCount: this.runtime.agentCount,
			wave: waveNumber,
			sharedState: observation.sharedState,
			agents: this.buildAgentSummaries(observation),
			conflicts: observation.conflicts.map((conflict) => this.toPlannerConflict(conflict)),
			recentWaves: this.waves.slice(-5).map((wave) => this.toWaveSummary(wave)),
		};
	}

	private buildAgentSummaries(observation: CoordinatorResult): MultiAgentPlannerAgentState[] {
		return Array.from({ length: this.runtime.agentCount }, (_, agentId) => {
			const state = observation.states[agentId];
			const lastResult = this.findLastAgentResult(observation.results, agentId);
			const summary: MultiAgentPlannerAgentState = { agentId };
			if (state?.url) summary.url = state.url;
			if (state?.title) summary.title = state.title;
			if (lastResult) summary.lastTaskSucceeded = lastResult.success;
			return summary;
		});
	}

	private findLastAgentResult(results: AgentResult[], agentId: number): AgentResult | undefined {
		for (let i = results.length - 1; i >= 0; i--) {
			if (results[i]?.agentId === agentId) return results[i];
		}
		return undefined;
	}

	private toPlannerConflict(conflict: CoordinatorResult["conflicts"][number]): MultiAgentPlannerConflict {
		const compact: MultiAgentPlannerConflict = {
			key: conflict.key,
			strategy: conflict.strategy,
			accepted: conflict.accepted,
		};
		if (conflict.agentId !== undefined) compact.agentId = conflict.agentId;
		return compact;
	}

	private toWaveSummary(wave: CoordinationWave): MultiAgentPlannerWaveSummary {
		const successes = wave.result.results.filter((result) => result.success).length;
		return {
			wave: wave.wave,
			assessment: wave.plan.assessment,
			successes,
			failures: wave.result.results.length - successes,
			conflicts: wave.result.conflicts.length,
		};
	}

	private toAgentTasks(plan: TaskPlan): AgentTask[] {
		const tasks: AgentTask[] = [];

		for (const [stepIndex, step] of plan.steps.entries()) {
			const action = this.normalizeAction(step.tool);
			if (!action) continue;

			const agentId = this.resolveAgentId(step.args["agentId"], stepIndex);
			const params = { ...step.args };
			delete params["agentId"];
			delete params["resultKey"];
			delete params["conflictStrategy"];

			if (step.tool === "waitForTimeout" && params["ms"] === undefined) {
				params["ms"] = 1000;
			}

			const task: AgentTask = { agentId, action };
			if (Object.keys(params).length > 0) task.params = params;

			const resultKey = step.args["resultKey"];
			if (typeof resultKey === "string" && resultKey.trim()) task.resultKey = resultKey.trim();

			const strategy = step.args["conflictStrategy"];
			if (typeof strategy === "string" && CONFLICT_STRATEGIES.has(strategy as SharedStateConflictStrategy)) {
				task.conflictStrategy = strategy as SharedStateConflictStrategy;
			}

			tasks.push(task);
		}

		return tasks;
	}

	private normalizeAction(tool: string): AgentTask["action"] | null {
		if (SUPPORTED_ACTIONS.has(tool as AgentTask["action"])) return tool as AgentTask["action"];

		switch (tool) {
			case "open":
			case "goto":
				return "navigate";
			case "fill":
				return "type";
			case "state":
				return "getState";
			case "waitForTimeout":
				return "wait";
			default:
				return null;
		}
	}

	private resolveAgentId(rawAgentId: unknown, stepIndex: number): number {
		if (
			typeof rawAgentId === "number" &&
			Number.isInteger(rawAgentId) &&
			rawAgentId >= 0 &&
			rawAgentId < this.runtime.agentCount
		) {
			return rawAgentId;
		}
		return stepIndex % this.runtime.agentCount;
	}

	private buildResult(
		status: PlanDelegateObserveResult["status"],
		stopReason: CoordinationStopReason,
		startTime: number,
		finalPlan?: TaskPlan,
	): PlanDelegateObserveResult {
		const result: PlanDelegateObserveResult = {
			status,
			stopReason,
			goal: this.options.goal,
			waves: [...this.waves],
			totalWaves: this.waves.length,
			totalDurationMs: Date.now() - startTime,
			sharedState: this.runtime.getSharedState(),
		};
		if (finalPlan) result.finalPlan = finalPlan;
		return result;
	}
}
