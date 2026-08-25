/**
 * @file AgentCoordinator.ts
 * @description Multi-agent orchestrator — spawns N Talox instances,
 * distributes tasks, merges results, shares state across planning waves,
 * and coordinates shutdown.
 *
 * ## Usage
 *
 * ```ts
 * import { AgentCoordinator } from "talox";
 *
 * const coordinator = new AgentCoordinator({ agents: 3, baseDir: "./profiles" });
 * await coordinator.launch({ profileClass: "ops" });
 *
 * const results = await coordinator.run([
 *   {
 *     agentId: 0,
 *     action: "navigate",
 *     params: { url: "https://site-a.com" },
 *     resultKey: "siteA",
 *   },
 *   {
 *     agentId: 1,
 *     action: "navigate",
 *     params: { url: "https://site-b.com" },
 *     resultKey: "siteB",
 *   },
 * ]);
 *
 * console.log(results.sharedState);
 * await coordinator.stop();
 * ```
 *
 * ## CLI
 *
 * ```bash
 * talox run --agents 3 "scrape top 10 CRM pricing and compare features"
 * ```
 */

import type { ProfileClass, TaloxPageState } from "../types/index.js";
import type { TaloxSettings } from "../types/settings.js";
import { TaloxController } from "./controller/TaloxController.js";
import { createLogger } from "./Logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SharedStateConflictStrategy = "first-write-wins" | "last-write-wins" | "reject";

export interface CoordinatorConfig {
	/** Number of agents to spawn. Default: 2. */
	agents?: number;
	/** Base directory for browser profiles. Default: "./profiles". */
	baseDir?: string;
	/** Shared settings applied to all agents. */
	settings?: TaloxSettings;
	/** Initial values available in the coordinator shared state bag. */
	initialSharedState?: Record<string, unknown>;
	/** Default conflict strategy for resultKey collisions. Default: "last-write-wins". */
	conflictStrategy?: SharedStateConflictStrategy;
}

export interface AgentTask {
	/** Which agent (0-indexed) executes this task. */
	agentId: number;
	/** Action to perform. */
	action: "navigate" | "click" | "type" | "getState" | "screenshot" | "wait";
	/** Parameters for the action. */
	params?: Record<string, unknown>;
	/** Optional key used to merge successful task data into shared state. */
	resultKey?: string;
	/** Optional per-task override for resultKey conflict handling. */
	conflictStrategy?: SharedStateConflictStrategy;
}

export interface AgentResult {
	agentId: number;
	task: AgentTask;
	success: boolean;
	data?: unknown;
	error?: string;
	durationMs: number;
	/** Whether this result was accepted into shared state via resultKey. */
	mergedToSharedState?: boolean;
}

export interface SharedStateConflict {
	key: string;
	existing: unknown;
	incoming: unknown;
	strategy: SharedStateConflictStrategy;
	accepted: boolean;
	agentId?: number;
}

export interface SharedStateWriteResult {
	key: string;
	accepted: boolean;
	value: unknown;
	conflict?: SharedStateConflict;
}

export interface CoordinatorResult {
	/** All individual agent results in the same order as the input task list. */
	results: AgentResult[];
	/** Latest known page state for every agent, including agents idle in this run. */
	states: Array<TaloxPageState | null>;
	/** Snapshot of the shared state bag after deterministic result merging. */
	sharedState: Readonly<Record<string, unknown>>;
	/** Result-key conflicts encountered during this run. */
	conflicts: SharedStateConflict[];
	/** Total wall-clock time for the run. */
	totalDurationMs: number;
}

export interface AgentStatus {
	id: number;
	profileId: string;
	busy: boolean;
	currentUrl?: string;
	lastResult?: AgentResult;
}

interface IndexedTask {
	index: number;
	task: AgentTask;
}

// ─── AgentCoordinator ─────────────────────────────────────────────────────────

const log = createLogger("Coordinator");

export class AgentCoordinator {
	private readonly config: Required<CoordinatorConfig>;
	private agents: Array<TaloxController | undefined> = [];
	private readonly statuses: AgentStatus[];
	private readonly sharedState = new Map<string, unknown>();
	private lastStates: Array<TaloxPageState | null>;
	private launched = false;
	private stopInFlight: Promise<void> | null = null;

	constructor(config: CoordinatorConfig = {}) {
		const agentCount = config.agents ?? 2;
		if (!Number.isInteger(agentCount) || agentCount < 1) {
			throw new Error(`AgentCoordinator requires a positive integer agent count; received ${agentCount}`);
		}

		this.config = {
			agents: agentCount,
			baseDir: config.baseDir ?? "./profiles",
			settings: (config.settings ?? {}) as TaloxSettings,
			initialSharedState: config.initialSharedState ?? {},
			conflictStrategy: config.conflictStrategy ?? "last-write-wins",
		};

		for (const [key, value] of Object.entries(this.config.initialSharedState)) {
			this.sharedState.set(key, value);
		}

		this.statuses = Array.from({ length: this.config.agents }, (_, id) => ({
			id,
			profileId: `agent-${id}`,
			busy: false,
		}));
		this.lastStates = Array.from({ length: this.config.agents }, () => null);
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────────────

	/**
	 * Launch all agents with separate browser profiles.
	 * Each agent gets `{baseDir}/agent-{N}` as its profile directory.
	 * Launch is atomic from the coordinator's perspective: if any agent fails,
	 * the failing controller and all previously started controllers are stopped.
	 */
	async launch(options?: { profileClass?: ProfileClass; headed?: boolean }): Promise<void> {
		if (this.launched) {
			log.warn("Coordinator already launched");
			return;
		}
		if (this.stopInFlight) {
			throw new Error("Coordinator is stopping. Wait for cleanup to finish before relaunching.");
		}
		if (this.agents.some((agent) => agent !== undefined)) {
			throw new Error("Coordinator has agents awaiting cleanup. Call stop() again before relaunching.");
		}

		const profileClass = options?.profileClass ?? "ops";

		try {
			for (let i = 0; i < this.config.agents; i++) {
				const profileId = `agent-${i}`;
				const agentBaseDir = `${this.config.baseDir}/${profileId}`;
				const agentSettings = {
					...this.config.settings,
					headed: options?.headed ?? this.config.settings.headed ?? false,
				};

				const agent = new TaloxController(agentBaseDir, { settings: agentSettings });
				this.agents[i] = agent;
				await agent.launch(profileId, profileClass, "chromium");
				log.info(`Agent ${i} launched (profile: ${profileId})`);
			}

			this.launched = true;
			log.info(`All ${this.config.agents} agents launched`);
		} catch (error) {
			try {
				await this.stop();
			} catch (cleanupError) {
				log.error(
					`Coordinator cleanup after launch failure failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
				);
			}
			throw error;
		}
	}

	/**
	 * Stop all agents and clean up browser processes.
	 * Successful agents are removed immediately; failed agents remain available
	 * for a later retry and keep the coordinator in a non-runnable state.
	 */
	stop(): Promise<void> {
		if (this.stopInFlight) return this.stopInFlight;

		const attempt = this.runStop();
		this.stopInFlight = attempt;
		attempt.then(
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
		);
		return attempt;
	}

	private async runStop(): Promise<void> {
		this.launched = false;
		const activeAgents = this.agents
			.map((agent, index) => (agent ? { agent, index } : null))
			.filter((entry): entry is { agent: TaloxController; index: number } => entry !== null);
		const results = await Promise.allSettled(activeAgents.map(({ agent }) => agent.stop()));
		const failures: string[] = [];

		for (const [resultIndex, result] of results.entries()) {
			const entry = activeAgents[resultIndex];
			if (!entry) continue;
			const { agent, index } = entry;
			const status = this.statuses[index];
			if (status) status.busy = false;

			if (result.status === "fulfilled") {
				if (this.agents[index] === agent) this.agents[index] = undefined;
				this.lastStates[index] = null;
				if (status) {
					delete status.currentUrl;
					delete status.lastResult;
				}
				log.info(`Agent ${index} stopped`);
				continue;
			}

			const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
			log.error(`Agent ${index} stop error: ${message}`);
			failures.push(`agent ${index}: ${message}`);
		}

		if (failures.length > 0) {
			throw new Error(`Failed to stop ${failures.length} coordinator agent(s): ${failures.join("; ")}`);
		}

		this.agents = [];
		this.lastStates = Array.from({ length: this.config.agents }, () => null);
		for (const status of this.statuses) {
			status.busy = false;
			delete status.currentUrl;
			delete status.lastResult;
		}
	}

	// ─── Execution ──────────────────────────────────────────────────────────────

	/**
	 * Execute a batch of tasks in parallel across all agents.
	 * Tasks targeting different agents run concurrently.
	 * Tasks targeting the same agent run sequentially.
	 *
	 * Successful tasks with a `resultKey` are merged into the shared state bag
	 * after execution in original input order, making conflict handling deterministic
	 * even when agents finish at different times.
	 */
	async run(tasks: AgentTask[]): Promise<CoordinatorResult> {
		if (!this.launched) {
			throw new Error("Coordinator not launched. Call launch() first.");
		}

		const startTime = Date.now();
		const resultSlots: Array<AgentResult | undefined> = new Array(tasks.length);
		const states: Array<TaloxPageState | null> = [...this.lastStates];

		const byAgent = new Map<number, IndexedTask[]>();
		for (const [index, task] of tasks.entries()) {
			const existing = byAgent.get(task.agentId) ?? [];
			existing.push({ index, task });
			byAgent.set(task.agentId, existing);
		}

		const agentPromises = Array.from(byAgent.entries()).map(async ([agentId, indexedTasks]) => {
			const agent = this.agents[agentId];
			const status = this.statuses[agentId];

			if (!agent) {
				for (const { index, task } of indexedTasks) {
					resultSlots[index] = {
						agentId,
						task,
						success: false,
						error: `Agent ${agentId} not found`,
						durationMs: 0,
					};
				}
				return;
			}

			if (status) status.busy = true;

			try {
				let lastResult: AgentResult | undefined;
				for (const { index, task } of indexedTasks) {
					const result = await this.runTask(agent, task);
					resultSlots[index] = result;
					lastResult = result;
					if (status) status.lastResult = result;
				}

				try {
					const stateFromResult = lastResult?.success ? this.asPageState(lastResult.data) : null;
					let state = stateFromResult;
					if (!state) {
						const collected = await agent.getState();
						const collectionError = this.controllerErrorMessage(collected);
						if (collectionError && this.lastStates[agentId]) return;
						state = collected;
					}
					states[agentId] = state;
					this.lastStates[agentId] = state;
					if (status) status.currentUrl = state.url;
				} catch {
					// Keep the previous known state. A transient state-collection failure
					// after a non-state action must not erase useful planner context.
				}
			} finally {
				if (status) status.busy = false;
			}
		});

		await Promise.all(agentPromises);

		const results = resultSlots.filter((result): result is AgentResult => result !== undefined);
		const conflicts = this.mergeResultsIntoSharedState(results);

		return {
			results,
			states,
			sharedState: this.getSharedState(),
			conflicts,
			totalDurationMs: Date.now() - startTime,
		};
	}

	/**
	 * Map an array of values to agents in round-robin fashion.
	 * Useful for distributing URLs, selectors, or search terms across agents.
	 */
	mapToAgents<T>(items: T[], factory: (item: T) => Omit<AgentTask, "agentId">): AgentTask[] {
		return items.map((item, i) => ({
			...factory(item),
			agentId: i % this.config.agents,
		}));
	}

	// ─── Shared State ───────────────────────────────────────────────────────────

	/** Return a shallow, immutable snapshot of the coordinator shared state bag. */
	getSharedState(): Readonly<Record<string, unknown>> {
		return Object.freeze(Object.fromEntries(this.sharedState.entries()));
	}

	/** Read one shared state value. */
	getSharedValue<T = unknown>(key: string): T | undefined {
		return this.sharedState.get(key) as T | undefined;
	}

	/**
	 * Write one shared state value with explicit conflict handling.
	 * Equal values are treated as idempotent writes and do not create a conflict.
	 */
	setSharedValue(
		key: string,
		value: unknown,
		strategy: SharedStateConflictStrategy = this.config.conflictStrategy,
	): SharedStateWriteResult {
		if (!key.trim()) throw new Error("Shared state key must not be empty");

		if (!this.sharedState.has(key)) {
			this.sharedState.set(key, value);
			return { key, accepted: true, value };
		}

		const existing = this.sharedState.get(key);
		if (Object.is(existing, value)) {
			return { key, accepted: true, value: existing };
		}

		const accepted = strategy === "last-write-wins";
		if (accepted) this.sharedState.set(key, value);

		const conflict: SharedStateConflict = {
			key,
			existing,
			incoming: value,
			strategy,
			accepted,
		};

		return {
			key,
			accepted,
			value: accepted ? value : existing,
			conflict,
		};
	}

	/** Delete one shared state key. Returns true when a key existed. */
	deleteSharedValue(key: string): boolean {
		return this.sharedState.delete(key);
	}

	/** Reset the shared state bag, optionally replacing it with a new snapshot. */
	clearSharedState(next: Record<string, unknown> = {}): void {
		this.sharedState.clear();
		for (const [key, value] of Object.entries(next)) {
			this.sharedState.set(key, value);
		}
	}

	// ─── Query ──────────────────────────────────────────────────────────────────

	/** Get a snapshot of all agent statuses. */
	getStatus(): AgentStatus[] {
		return this.statuses.map((status) => ({ ...status }));
	}

	/** Number of agents in this coordinator. */
	get agentCount(): number {
		return this.config.agents;
	}

	/** Get a specific agent controller (for advanced usage). */
	getAgent(index: number): TaloxController | undefined {
		return this.agents[index];
	}

	// ─── Internal ───────────────────────────────────────────────────────────────

	private async runTask(agent: TaloxController, task: AgentTask): Promise<AgentResult> {
		const t0 = Date.now();
		try {
			const data = await this.executeTask(agent, task);
			const controllerError = this.controllerErrorMessage(data);
			if (controllerError) {
				return {
					agentId: task.agentId,
					task,
					success: false,
					data,
					error: controllerError,
					durationMs: Date.now() - t0,
				};
			}
			return {
				agentId: task.agentId,
				task,
				success: true,
				data,
				durationMs: Date.now() - t0,
			};
		} catch (err) {
			return {
				agentId: task.agentId,
				task,
				success: false,
				error: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - t0,
			};
		}
	}

	private asPageState(value: unknown): TaloxPageState | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const candidate = value as Partial<TaloxPageState>;
		return typeof candidate.url === "string" &&
			typeof candidate.title === "string" &&
			typeof candidate.timestamp === "string"
			? (value as TaloxPageState)
			: null;
	}

	private controllerErrorMessage(value: unknown): string | null {
		const state = this.asPageState(value);
		if (!state || state.url !== "" || state.title !== "Error") return null;
		const consoleErrors = (state as TaloxPageState & { console?: { errors?: unknown[] } }).console?.errors;
		const firstError = consoleErrors?.find((entry): entry is string => typeof entry === "string" && entry.length > 0);
		return firstError ?? "Talox controller action failed";
	}

	private mergeResultsIntoSharedState(results: AgentResult[]): SharedStateConflict[] {
		const conflicts: SharedStateConflict[] = [];

		for (const result of results) {
			const key = result.task.resultKey;
			if (!result.success || !key) continue;

			const write = this.setSharedValue(key, result.data, result.task.conflictStrategy);
			result.mergedToSharedState = write.accepted;

			if (write.conflict) {
				conflicts.push({ ...write.conflict, agentId: result.agentId });
			}
		}

		return conflicts;
	}

	private async executeTask(agent: TaloxController, task: AgentTask): Promise<unknown> {
		switch (task.action) {
			case "navigate": {
				const url = task.params?.["url"];
				if (typeof url !== "string" || !url) throw new Error("navigate requires 'url' param");
				return agent.navigate(url);
			}
			case "click": {
				const selector = task.params?.["selector"];
				if (typeof selector !== "string" || !selector) throw new Error("click requires 'selector' param");
				return agent.click(selector);
			}
			case "type": {
				const selector = task.params?.["selector"];
				const text = task.params?.["text"];
				if (typeof selector !== "string" || !selector || typeof text !== "string") {
					throw new Error("type requires 'selector' and 'text' params");
				}
				return agent.type(selector, text);
			}
			case "getState": {
				return agent.getState();
			}
			case "screenshot": {
				const selector = task.params?.["selector"];
				return agent.screenshot(typeof selector === "string" ? { selector } : undefined);
			}
			case "wait": {
				const rawMs = task.params?.["ms"] ?? 1000;
				const ms = typeof rawMs === "number" ? rawMs : Number(rawMs);
				if (!Number.isFinite(ms) || ms < 0) throw new Error("wait requires a non-negative numeric 'ms' param");
				await new Promise((resolve) => setTimeout(resolve, ms));
				return { waitedMs: ms };
			}
			default:
				throw new Error(`Unknown action: ${task.action}`);
		}
	}
}
