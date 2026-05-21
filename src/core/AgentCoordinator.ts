/**
 * @file AgentCoordinator.ts
 * @description Multi-agent orchestrator — spawns N Talox instances,
 * distributes tasks, merges results, and coordinates shutdown.
 *
 * ## Usage
 *
 * ```ts
 * import { AgentCoordinator } from "talox";
 *
 * const coordinator = new AgentCoordinator({ agents: 3, baseDir: "./profiles" });
 * await coordinator.launch({ profileClass: "ops" });
 *
 * // Distribute tasks — each agent gets a different URL
 * const results = await coordinator.run({
 *   tasks: [
 *     { agentId: 0, action: "navigate", params: { url: "https://site-a.com" } },
 *     { agentId: 1, action: "navigate", params: { url: "https://site-b.com" } },
 *     { agentId: 2, action: "navigate", params: { url: "https://site-c.com" } },
 *   ],
 * });
 *
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

export interface CoordinatorConfig {
	/** Number of agents to spawn. Default: 2. */
	agents?: number;
	/** Base directory for browser profiles. Default: "./profiles". */
	baseDir?: string;
	/** Shared settings applied to all agents. */
	settings?: TaloxSettings;
}

export interface AgentTask {
	/** Which agent (0-indexed) executes this task. */
	agentId: number;
	/** Action to perform. */
	action: "navigate" | "click" | "type" | "getState" | "screenshot" | "wait";
	/** Parameters for the action. */
	params?: Record<string, string>;
}

export interface AgentResult {
	agentId: number;
	task: AgentTask;
	success: boolean;
	data?: unknown;
	error?: string;
	durationMs: number;
}

export interface CoordinatorResult {
	/** All individual agent results. */
	results: AgentResult[];
	/** Aggregated page states from all agents. */
	states: Array<TaloxPageState | null>;
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

// ─── AgentCoordinator ─────────────────────────────────────────────────────────

const log = createLogger("Coordinator");

export class AgentCoordinator {
	private readonly config: Required<CoordinatorConfig>;
	private agents: TaloxController[] = [];
	private launched = false;

	constructor(config: CoordinatorConfig = {}) {
		this.config = {
			agents: config.agents ?? 2,
			baseDir: config.baseDir ?? "./profiles",
			settings: (config.settings ?? {}) as TaloxSettings,
		};
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────────────

	/**
	 * Launch all agents with separate browser profiles.
	 * Each agent gets `{baseDir}/agent-{N}` as its profile directory.
	 */
	async launch(options?: { profileClass?: ProfileClass; headed?: boolean }): Promise<void> {
		if (this.launched) {
			log.warn("Coordinator already launched");
			return;
		}

		const profileClass = options?.profileClass ?? "ops";

		for (let i = 0; i < this.config.agents; i++) {
			const profileId = `agent-${i}`;
			const agentBaseDir = `${this.config.baseDir}/${profileId}`;
			const agentSettings = {
				...this.config.settings,
				headed: options?.headed ?? this.config.settings.headed ?? false,
		};

			const agent = new TaloxController(agentBaseDir, { settings: agentSettings });
			await agent.launch(profileId, profileClass, "chromium");

			this.agents.push(agent);
			log.info(`Agent ${i} launched (profile: ${profileId})`);
		}

		this.launched = true;
		log.info(`All ${this.config.agents} agents launched`);
	}

	/**
	 * Stop all agents and clean up browser processes.
	 */
	async stop(): Promise<void> {
		for (const [i, agent] of this.agents.entries()) {
			try {
				await agent.stop();
				log.info(`Agent ${i} stopped`);
			} catch (err) {
				log.error(`Agent ${i} stop error: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		this.agents = [];
		this.launched = false;
	}

	// ─── Execution ──────────────────────────────────────────────────────────────

	/**
	 * Execute a batch of tasks in parallel across all agents.
	 * Tasks targeting different agents run concurrently.
	 * Tasks targeting the same agent run sequentially.
	 */
	async run(tasks: AgentTask[]): Promise<CoordinatorResult> {
		if (!this.launched) {
			throw new Error("Coordinator not launched. Call launch() first.");
		}

		const startTime = Date.now();
		const results: AgentResult[] = [];
		const states: Array<TaloxPageState | null> = [];

		// Group tasks by agent
		const byAgent = new Map<number, AgentTask[]>();
		for (const task of tasks) {
			const existing = byAgent.get(task.agentId) ?? [];
			existing.push(task);
			byAgent.set(task.agentId, existing);
		}

		// Execute each agent's tasks sequentially, but agents in parallel
		const agentPromises = Array.from(byAgent.entries()).map(async ([agentId, agentTasks]) => {
			const agent = this.agents[agentId];
			if (!agent) {
				results.push({
					agentId,
					task: agentTasks[0]!,
					success: false,
					error: `Agent ${agentId} not found`,
					durationMs: 0,
				});
				return;
			}

			for (const task of agentTasks) {
				const t0 = Date.now();
				try {
					const data = await this.executeTask(agent, task);
					results.push({
						agentId,
						task,
						success: true,
						data,
						durationMs: Date.now() - t0,
					});
				} catch (err) {
					results.push({
						agentId,
						task,
						success: false,
						error: err instanceof Error ? err.message : String(err),
						durationMs: Date.now() - t0,
					});
				}
			}

			// Grab final state from each agent
			try {
				const state = await agent.getState();
				states[agentId] = state;
			} catch {
				states[agentId] = null;
			}
		});

		await Promise.all(agentPromises);

		return {
			results,
			states,
			totalDurationMs: Date.now() - startTime,
		};
	}

	/**
	 * Map an array of values to agents in round-robin fashion.
	 * Useful for distributing URLs, selectors, or search terms across agents.
	 *
	 * @example
	 * ```ts
	 * const urls = ["url-a", "url-b", "url-c", "url-d"];
	 * const tasks = coordinator.mapToAgents(urls, (url) => ({
	 *   action: "navigate" as const,
	 *   params: { url },
	 * }));
	 * const result = await coordinator.run(tasks);
	 * ```
	 */
	mapToAgents<T>(items: T[], factory: (item: T) => Omit<AgentTask, "agentId">): AgentTask[] {
		return items.map((item, i) => ({
			...factory(item),
			agentId: i % this.config.agents,
		}));
	}

	// ─── Query ──────────────────────────────────────────────────────────────────

	/**
	 * Get status of all agents.
	 */
	getStatus(): AgentStatus[] {
		return Array.from({ length: this.config.agents }, (_, i) => ({
			id: i,
			profileId: `agent-${i}`,
			busy: false,
		}));
	}

	/**
	 * Number of agents in this coordinator.
	 */
	get agentCount(): number {
		return this.config.agents;
	}

	/**
	 * Get a specific agent controller (for advanced usage).
	 */
	getAgent(index: number): TaloxController | undefined {
		return this.agents[index];
	}

	// ─── Internal ───────────────────────────────────────────────────────────────

	private async executeTask(agent: TaloxController, task: AgentTask): Promise<unknown> {
		switch (task.action) {
			case "navigate": {
				const url = task.params?.["url"];
				if (!url) throw new Error("navigate requires 'url' param");
				return agent.navigate(url);
			}
			case "click": {
				const selector = task.params?.["selector"];
				if (!selector) throw new Error("click requires 'selector' param");
				return agent.click(selector);
			}
			case "type": {
				const selector = task.params?.["selector"];
				const text = task.params?.["text"];
				if (!selector || !text) throw new Error("type requires 'selector' and 'text' params");
				return agent.type(selector, text);
			}
			case "getState": {
				return agent.getState();
			}
			case "screenshot": {
				return agent.screenshot(
					task.params?.["selector"]
						? { selector: task.params["selector"] }
						: undefined,
				);
			}
			case "wait": {
				const ms = Number(task.params?.["ms"] ?? 1000);
				await new Promise((r) => setTimeout(r, ms));
				return { waitedMs: ms };
			}
			default:
				throw new Error(`Unknown action: ${task.action}`);
		}
	}
}
