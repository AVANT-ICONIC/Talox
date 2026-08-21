import path from "node:path";
import { AgentCoordinator } from "../core/AgentCoordinator.js";
import { PlanDelegateObserveLoop, type PlanDelegateObserveOptions } from "../core/loop/PlanDelegateObserveLoop.js";
import type { LoopStrategy, PlannerConfig, TaskGoal } from "../core/loop/types.js";
import type { TaloxSettings } from "../types/settings.js";

export interface MultiAgentRunOptions {
	goal: string;
	url?: string;
	model: string;
	apiKey?: string;
	baseUrl?: string;
	maxIterations: number;
	strategy: LoopStrategy;
	skillsDir?: string;
	agents: number;
}

const VALID_STRATEGIES = new Set<LoopStrategy>(["conservative", "balanced", "aggressive"]);

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
	if (raw === undefined) return fallback;
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Read --agents without fully parsing the run command. Supports --agents=N too. */
export function readAgentCount(args: string[]): number {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--agents") return parsePositiveInteger(args[i + 1], 1);
		if (arg?.startsWith("--agents=")) return parsePositiveInteger(arg.slice("--agents=".length), 1);
	}
	return 1;
}

/** True when the top-level CLI should route a run command into multi-agent mode. */
export function shouldUseMultiAgentRun(argv: string[]): boolean {
	if (argv[0] !== "run") return false;
	if (argv.includes("--help") || argv.includes("-h")) return false;
	return readAgentCount(argv.slice(1)) > 1;
}

/** Parse the subset of `talox run` options shared by the multi-agent runtime. */
export function parseMultiAgentRunOptions(args: string[]): MultiAgentRunOptions {
	const opts: MultiAgentRunOptions = {
		goal: "",
		model: "gpt-4o",
		maxIterations: 10,
		strategy: "balanced",
		agents: 1,
	};
	const positional: string[] = [];

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (!arg) {
			i += 1;
			continue;
		}

		if (arg.startsWith("--agents=")) {
			opts.agents = parsePositiveInteger(arg.slice("--agents=".length), opts.agents);
			i += 1;
			continue;
		}

		switch (arg) {
			case "--url": {
				const value = args[i + 1];
				if (value !== undefined) opts.url = value;
				i += 2;
				break;
			}
			case "--model":
				opts.model = args[i + 1] ?? opts.model;
				i += 2;
				break;
			case "--api-key": {
				const value = args[i + 1];
				if (value !== undefined) opts.apiKey = value;
				i += 2;
				break;
			}
			case "--base-url": {
				const value = args[i + 1];
				if (value !== undefined) opts.baseUrl = value;
				i += 2;
				break;
			}
			case "--max-iterations":
				opts.maxIterations = parsePositiveInteger(args[i + 1], opts.maxIterations);
				i += 2;
				break;
			case "--strategy": {
				const raw = args[i + 1] as LoopStrategy | undefined;
				if (raw && VALID_STRATEGIES.has(raw)) opts.strategy = raw;
				i += 2;
				break;
			}
			case "--skills-dir": {
				const value = args[i + 1];
				if (value !== undefined) opts.skillsDir = value;
				i += 2;
				break;
			}
			case "--agents":
				opts.agents = parsePositiveInteger(args[i + 1], opts.agents);
				i += 2;
				break;
			default:
				if (!arg.startsWith("-")) positional.push(arg);
				i += 1;
				break;
		}
	}

	opts.goal = positional.join(" ").trim();
	return opts;
}

export async function runMultiAgentRun(args: string[]): Promise<void> {
	const opts = parseMultiAgentRunOptions(args);
	if (!opts.goal) {
		console.error('[Talox CLI] Error: No goal provided. Usage: talox run "<goal>" --agents <N> [options]');
		process.exitCode = 1;
		return;
	}
	if (opts.agents < 2) {
		throw new Error("Multi-agent run requires at least 2 agents");
	}

	const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
	if (!apiKey) {
		console.error("[Talox CLI] Error: Multi-agent run requires an API key. Use --api-key or set OPENAI_API_KEY.");
		process.exitCode = 1;
		return;
	}

	console.log(`[Talox Run] Starting coordinated run with ${opts.agents} agents: "${opts.goal}"`);

	const coordinator = new AgentCoordinator({
		agents: opts.agents,
		baseDir: path.join(process.cwd(), ".talox", "profiles", "run"),
		settings: {
			headed: false,
			verbosity: 1,
		} as TaloxSettings,
	});

	const planner: PlannerConfig = {
		model: opts.model,
		apiKey,
	};
	const apiBaseUrl = opts.baseUrl ?? process.env["OPENAI_BASE_URL"];
	if (apiBaseUrl) planner.apiBaseUrl = apiBaseUrl;

	const goal: TaskGoal = {
		description: opts.goal,
		maxIterations: opts.maxIterations,
		strategy: opts.strategy,
	};
	if (opts.url) goal.startUrl = opts.url;

	let interrupting = false;
	const interrupt = () => {
		if (interrupting) return;
		interrupting = true;
		console.log("[Talox Run] Interrupt received — stopping agents...");
		void coordinator
			.stop()
			.catch((error: unknown) => {
				console.error(`[Talox Run] Shutdown error: ${error instanceof Error ? error.message : String(error)}`);
			})
			.finally(() => process.exit(130));
	};
	process.on("SIGINT", interrupt);

	try {
		await coordinator.launch({ profileClass: "ops", headed: false });

		const loopOptions: PlanDelegateObserveOptions = {
			goal,
			planner,
			maxWaves: opts.maxIterations,
			onProgress(wave) {
				const successful = wave.result.results.filter((result) => result.success).length;
				console.log(
					`[ wave ${wave.wave} ] ${successful}/${wave.tasks.length} tasks succeeded · ${wave.result.conflicts.length} conflicts`,
				);
			},
		};
		if (opts.skillsDir) loopOptions.skillsDir = opts.skillsDir;

		const loop = new PlanDelegateObserveLoop(coordinator, loopOptions);
		const result = await loop.run();
		console.log("");
		console.log(`[Talox CLI] Multi-agent run completed: ${result.status}`);
		console.log(`[Talox CLI] Stop reason: ${result.stopReason}`);
		console.log(`[Talox CLI] Waves: ${result.totalWaves}`);
		console.log(`[Talox CLI] Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
		const sharedKeys = Object.keys(result.sharedState);
		console.log(`[Talox CLI] Shared state keys: ${sharedKeys.join(", ") || "none"}`);
		if (result.status === "failed") process.exitCode = 1;
	} finally {
		process.off("SIGINT", interrupt);
		if (!interrupting) await coordinator.stop();
	}
}
