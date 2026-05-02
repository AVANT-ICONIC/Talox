/**
 * @file AutonomousLoop.ts
 * @description Main orchestrator for Talox v6.0 — ties together TaloxController,
 * Planner, SkillWriter, and SkillLoader into an observe→plan→act→learn→retry loop.
 *
 * The loop composes (not extends) a TaloxController instance and drives the
 * autonomous agent lifecycle: observe page state, plan the next action via an
 * LLM planner, execute a single step, and re-evaluate.
 */

import type { AgentPageState } from "../../types/index.js";
import type { ChallengeState } from "../ChallengeDetector.js";
import type { TaloxController } from "../controller/TaloxController.js";
import { SkillLoader } from "../skills/SkillLoader.js";
import { SkillWriter } from "../skills/SkillWriter.js";
import type { Planner } from "./Planner.js";
import { LLMPlanner } from "./Planner.js";
import type {
	AutonomousLoopOptions,
	BlockerClassification,
	DynamicSkill,
	LoopIteration,
	LoopResult,
	LoopState,
	LoopStopReason,
	LoopStatus,
	PlanStep,
	StepResult,
} from "./types.js";

// ─── AutonomousLoop ──────────────────────────────────────────────────────────

export class AutonomousLoop {
	private readonly controller: TaloxController;
	private readonly planner: Planner;
	private readonly skillLoader: SkillLoader;
	private readonly skillWriter: SkillWriter | null;
	private readonly options: AutonomousLoopOptions;
	private state: LoopState | null = null;
	private abortController: AbortController | null = null;

	constructor(controller: TaloxController, options: AutonomousLoopOptions) {
		this.controller = controller;
		this.options = options;

		// Use planner override if provided (testing), otherwise create LLMPlanner
		this.planner = options.plannerOverride ?? new LLMPlanner(options.planner);

		// Create SkillLoader — use skillsDir if provided, otherwise default paths
		this.skillLoader = new SkillLoader(
			options.skillsDir ? [options.skillsDir] : undefined,
		);

		// Create SkillWriter only if skillsDir is provided
		this.skillWriter = options.skillsDir
			? new SkillWriter(options.skillsDir, this.skillLoader)
			: null;

		// Subscribe to controller events
		this.controller.on("stateChanged", this.handleStateChanged);
		this.controller.on("humanTakeoverRequested", this.handleHumanTakeoverRequested);
	}

	// ─── Public API ────────────────────────────────────────────────────────

	async run(): Promise<LoopResult> {
		const startTime = Date.now();
		this.state = this.createInitialState();
		this.abortController = new AbortController();

		// Navigate to startUrl if provided
		if (this.options.goal.startUrl) {
			try {
				await this.controller.navigate(this.options.goal.startUrl);
			} catch (error: unknown) {
				// Ignored: navigation failure will be caught in next iteration
				const msg = error instanceof Error ? error.message : String(error);
				this.state.status = "failed";
				this.state.stopReason = "error";
				return this.buildResult(startTime);
			}
		}

		// Main loop
		while (this.state.status === "running") {
			// Check budget constraints
			if (this.exceedsBudget(startTime)) {
				break;
			}

			// Check abort signal
			if (this.abortController.signal.aborted) {
				break;
			}

			// Run one iteration (observe → plan → act)
			const iteration = await this.runIteration();
			this.state.iterations.push(iteration);
			this.state.currentIteration = iteration.iteration;

			// Accumulate token usage
			if (iteration.tokenUsage) {
				this.state.totalTokenUsage.promptTokens += iteration.tokenUsage.promptTokens;
				this.state.totalTokenUsage.completionTokens += iteration.tokenUsage.completionTokens;
				this.state.totalTokenUsage.totalTokens += iteration.tokenUsage.totalTokens;
				this.state.totalTokenUsage.estimatedCostUsd += iteration.tokenUsage.estimatedCostUsd;
			}

			// Call onProgress callback if provided
			this.options.onProgress?.(iteration);

			// Check if goal achieved
			if (iteration.plan.goalAchieved) {
				this.state.status = "completed";
				this.state.stopReason = "goal-achieved";
				break;
			}

			// Check for unresolvable blocker
			if (iteration.plan.blocker && !iteration.plan.blocker.autoResolvable) {
				await this.handleBlocker(iteration.plan.blocker);
				if (this.state.status !== "running") {
					break;
				}
			}

			// Check for convergence / stuck loop
			if (this.isStuck()) {
				await this.handleStuckLoop();
				if (this.state.status !== "running") {
					break;
				}
			}
		}

		return this.buildResult(startTime);
	}

	stop(reason: LoopStopReason): void {
		if (this.state) {
			this.state.status = this.statusFromStopReason(reason);
			this.state.stopReason = reason;
		}
		this.abortController?.abort();
	}

	getState(): LoopState | null {
		return this.state;
	}

	/** Clean up event subscriptions. */
	dispose(): void {
		this.controller.off("stateChanged", this.handleStateChanged);
		this.controller.off("humanTakeoverRequested", this.handleHumanTakeoverRequested);
	}

	// ─── Private: Iteration ────────────────────────────────────────────────

	private async runIteration(): Promise<LoopIteration> {
		const iterationNumber = (this.state?.currentIteration ?? 0) + 1;

		// 1. OBSERVE — get compact agent state
		let pageState: AgentPageState;
		try {
			pageState = await this.controller.getState("agent") as AgentPageState;
		} catch (error: unknown) {
			// if we can't get state, return a failed iteration
			const msg = error instanceof Error ? error.message : String(error);
			return {
				iteration: iterationNumber,
				observation: `Failed to observe page state: ${msg}`,
				plan: { assessment: "State observation failed", steps: [], goalAchieved: false },
				result: { status: "failed", error: msg, durationMs: 0 },
				timestamp: new Date().toISOString(),
			};
		}

		// 2. Get challenge state
		let challengeState: ChallengeState | undefined;
		try {
			challengeState = await this.controller.getChallengeState();
		} catch { // Ignored: non-fatal error
			// Continue without challenge state
		}

		// 3. Load domain skills
		let skillsContext = "";
		try {
			const hostname = this.extractHostname(pageState.url);
			skillsContext = this.skillLoader.toContextForDomain(hostname);
		} catch { // Ignored: non-fatal error
			// Continue without skills context
		}

		// 4. Get domain hints from AdaptationEngine
		const domainHints = this.getDomainHints(pageState.url);

		// 5. PLAN
		const recentIterations = this.state?.iterations.slice(-5) ?? [];
		const plannerInput: import("./types.js").PlannerInput = {
			state: pageState,
			goal: this.options.goal,
			recentIterations,
			skillsContext,
		};
		if (challengeState) {
			plannerInput.challengeState = challengeState;
		}
		if (domainHints) {
			plannerInput.domainHints = domainHints;
		}
		const plan = await this.planner.plan(plannerInput);

		// 6. ACT — execute the first step from the plan
		let result: StepResult;
		const firstStep = plan.steps[0];
		if (firstStep) {
			result = await this.executeStep(firstStep);
		} else {
			result = { status: "skipped", durationMs: 0 };
		}

		return {
			iteration: iterationNumber,
			observation: plan.assessment,
			plan,
			result,
			timestamp: new Date().toISOString(),
		};
	}

	// ─── Private: Step Execution ───────────────────────────────────────────

	private async executeStep(step: PlanStep): Promise<StepResult> {
		const stepStart = Date.now();
		try {
			switch (step.tool) {
				case "navigate": {
					const url = step.args.url as string;
					const state = await this.controller.navigate(url);
					return {
						status: "success",
						state: state as unknown as AgentPageState,
						durationMs: Date.now() - stepStart,
					};
				}
				case "click": {
					const selector = step.args.selector as string;
					const state = await this.controller.click(selector);
					return {
						status: "success",
						state: state as unknown as AgentPageState,
						durationMs: Date.now() - stepStart,
					};
				}
				case "type": {
					const selector = step.args.selector as string;
					const text = step.args.text as string;
					const state = await this.controller.type(selector, text);
					return {
						status: "success",
						state: state as unknown as AgentPageState,
						durationMs: Date.now() - stepStart,
					};
				}
				case "scrollTo": {
					const selector = step.args.selector as string;
					const align = step.args.align as "start" | "center" | "end" | "nearest" | undefined;
					await this.controller.scrollTo(selector, align ?? "center");
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "screenshot": {
					const options = step.args.path
						? { path: step.args.path as string }
						: step.args.selector
							? { selector: step.args.selector as string }
							: undefined;
					await this.controller.screenshot(options);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "getState": {
					const state = await this.controller.getState("agent") as AgentPageState;
					return { status: "success", state, durationMs: Date.now() - stepStart };
				}
				case "waitForSelector": {
					const selector = step.args.selector as string;
					const timeout = step.args.timeout as number | undefined;
					await this.controller.waitForSelector(selector, timeout ?? 30000);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "waitForNavigation": {
					const timeout = step.args.timeout as number | undefined;
					await this.controller.waitForNavigation(timeout ?? 30000);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "waitForTimeout": {
					const ms = step.args.ms as number;
					await this.controller.waitForTimeout(ms);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "evaluate": {
					const script = step.args.script as string;
					await this.controller.evaluate(script);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "extractTable": {
					const selector = step.args.selector as string;
					await this.controller.extractTable(selector);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				case "findElement": {
					const text = step.args.text as string;
					const elementType = step.args.elementType as
						| "button"
						| "link"
						| "input"
						| "checkbox"
						| "radio"
						| "menuitem"
						| "any"
						| undefined;
					await this.controller.findElement(text, elementType);
					return { status: "success", durationMs: Date.now() - stepStart };
				}
				default:
					return {
						status: "failed",
						error: `Unknown tool: ${step.tool}`,
						durationMs: Date.now() - stepStart,
					};
			}
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return { status: "failed", error: msg, durationMs: Date.now() - stepStart };
		}
	}

	// ─── Private: Convergence Detection ───────────────────────────────────

	/**
	 * Detect if the loop is stuck — same URL, same errors, same blocker type
	 * across the last few iterations. Returns true if the loop should break
	 * out or try a different strategy.
	 */
	private isStuck(): boolean {
		if (!this.state) return false;
		const iterations = this.state.iterations;
		if (iterations.length < 3) return false;

		const last3 = iterations.slice(-3);

		// Check 1: All 3 have the same result status ("failed" or "blocked")
		const statuses = last3.map((it) => it.result.status);
		if (statuses.every((s) => s === "failed") || statuses.every((s) => s === "blocked")) {
			// Check 2: All 3 have the same blocker type
			const blockerTypes = last3
				.map((it) => it.plan.blocker?.type)
				.filter(Boolean);
			if (
				blockerTypes.length >= 2 &&
				blockerTypes.every((t) => t === blockerTypes[0])
			) {
				return true;
			}

			// Check 3: All 3 have the same error message (trimmed to first 80 chars)
			const errors = last3
				.map((it) => it.result.error?.slice(0, 80))
				.filter(Boolean);
			if (
				errors.length >= 2 &&
				errors.every((e) => e === errors[0])
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Attempt to break out of a stuck loop by:
	 * 1. Trying to auto-generate a skill for the repeated blocker
	 * 2. If that fails, escalating to human
	 */
	private async handleStuckLoop(): Promise<void> {
		if (!this.state) return;
		const lastIteration = this.state.iterations[this.state.iterations.length - 1];
		if (!lastIteration) return;

		const blocker = lastIteration.plan.blocker;

		if (blocker && this.skillWriter) {
			// Try LLM-generated skill
			const skillCreated = await this.generateSkillFromBlocker(blocker);
			if (skillCreated) {
				// Skill created — loop will pick it up next iteration
				return;
			}
		}

		// Escalate to human if possible
		if (this.options.onHumanEscalation && lastIteration.result.error) {
			const resolution = await this.options.onHumanEscalation(
				`Loop stuck (iteration ${lastIteration.iteration}): ${lastIteration.result.error}`,
				this.state,
			);
			if (resolution) {
				// Human provided guidance — continue
				return;
			}
		}

		// No resolution — stop the loop
		this.state.status = "failed";
		this.state.stopReason = "unresolvable-blocker";
	}

	// ─── Private: Skill Generation ────────────────────────────────────────

	/**
	 * Use the LLM planner to generate a DynamicSkill from a blocker.
	 * The LLM receives the blocker context + recent history and produces
	 * a structured SKILL.md that teaches the agent how to handle this pattern.
	 */
	private async generateSkillFromBlocker(
		blocker: BlockerClassification,
	): Promise<boolean> {
		if (!this.skillWriter || !this.state) return false;

		try {
			// Build context for skill generation
			const recentHistory = this.state.iterations
				.slice(-3)
				.map(
					(it) =>
						`Iteration ${it.iteration}: ${it.observation} → ${it.result.status}${it.result.error ? ` (${it.result.error})` : ""}`,
				)
				.join("\n");

			const skill = await this.planner.generateSkill?.({
				blockerType: blocker.type,
				blockerDescription: blocker.description,
				evidence: blocker.evidence,
				suggestedApproach: blocker.suggestedApproach ?? "",
				recentHistory,
			});

			if (!skill) return false;

			// Determine domain from the last known URL
			const lastUrl = this.state.iterations
				.map((it) => it.result.state?.url)
				.filter(Boolean)
				.pop() ?? "unknown";
			const domain = this.extractHostname(lastUrl);

			// Write and validate the skill
			await this.skillWriter.createSkill({
				...skill,
				domain,
			});

			const valid = await this.skillWriter.validateSkill(skill.name);
			if (valid) {
				this.state.createdSkills.push(skill.name);
			}

			return valid;
		} catch { // Ignored: non-fatal error
			return false;
		}
	}

	// ─── Private: Helpers ──────────────────────────────────────────────────

	private createInitialState(): LoopState {
		return {
			goal: this.options.goal,
			currentIteration: 0,
			iterations: [],
			createdSkills: [],
			totalTokenUsage: {
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				estimatedCostUsd: 0,
			},
			startedAt: new Date().toISOString(),
			status: "running",
		};
	}

	private exceedsBudget(startTime: number): boolean {
		if (!this.state) return false;

		// Iteration budget
		if (this.state.currentIteration >= this.options.goal.maxIterations) {
			this.state.status = "budget-exhausted";
			this.state.stopReason = "max-iterations";
			return true;
		}

		// Cost budget
		if (
			this.options.goal.maxCostUsd !== undefined &&
			this.state.totalTokenUsage.estimatedCostUsd >= this.options.goal.maxCostUsd
		) {
			this.state.status = "budget-exhausted";
			this.state.stopReason = "max-cost";
			return true;
		}

		// Duration budget
		if (this.options.goal.maxDurationSeconds !== undefined) {
			const elapsed = (Date.now() - startTime) / 1000;
			if (elapsed >= this.options.goal.maxDurationSeconds) {
				this.state.status = "budget-exhausted";
				this.state.stopReason = "max-duration";
				return true;
			}
		}

		return false;
	}

	private getDomainHints(url: string): string {
		try {
			const adapt = (this.controller as any)._adapt; // NOSONAR — accessing readonly internal
			if (!adapt?.domainMemory) return "";
			const hostname = adapt.domainMemory.extractHostname?.(url);
			if (!hostname) return "";
			const record = adapt.domainMemory.getDomainRecord?.(url);
			if (!record) return "";
			const strategies = adapt.domainMemory.getRankedStrategies?.(url);
			if (!strategies || strategies.length === 0) return "";

			const lines = [
				`Domain: ${hostname}`,
				`Known strategies: ${strategies.map((s: any) => `${s.strategy}(${(s.ewmaSuccessRate * 100).toFixed(0)}%)`).join(", ")}`, // NOSONAR
			];
			return lines.join("\n");
		} catch { // Ignored: non-fatal error
			return "";
		}
	}

	private async handleBlocker(
		blocker: NonNullable<import("./types.js").TaskPlan["blocker"]>,
	): Promise<void> {
		if (!this.state) return;

		// Try skill creation if we have a SkillWriter
		if (this.skillWriter && blocker.suggestedApproach) {
			try {
				const hostname = this.state.iterations.length > 0
					? this.extractHostname(
							this.state.iterations[this.state.iterations.length - 1]?.plan?.assessment ?? "",
						)
					: "unknown";

				await this.skillWriter.createSkill({
					name: `blocker-${blocker.type}-${Date.now()}`,
					description: blocker.description,
					domain: hostname,
					version: "1.0",
					content: `# Auto-generated skill for ${blocker.type}\n\n${blocker.suggestedApproach}`,
					triggerCondition: `blocker type == "${blocker.type}"`,
					toolUsage: [],
				});

				this.state.createdSkills.push(`blocker-${blocker.type}`);
			} catch { // Ignored: non-fatal error
				// Skill creation failed, continue to escalation
			}
		}

		// Check if human escalation is possible
		if (this.options.onHumanEscalation) {
			const resolution = await this.options.onHumanEscalation(
				blocker.description,
				this.state,
			);
			if (resolution) {
				// Human provided a resolution, continue running
				return;
			}
		}

		// If the blocker requires human and no resolution was provided, stop
		if (!blocker.autoResolvable) {
			this.state.status = "human-takeover";
			this.state.stopReason = "unresolvable-blocker";
		}
	}

	private buildResult(startTime: number): LoopResult {
		const now = Date.now();
		return {
			status: (this.state?.status ?? "failed") as LoopResult["status"],
			goal: this.options.goal,
			totalIterations: this.state?.currentIteration ?? 0,
			totalDurationMs: now - startTime,
			totalCostUsd: this.state?.totalTokenUsage.estimatedCostUsd ?? 0,
			createdSkills: this.state?.createdSkills ?? [],
			stopReason: this.state?.stopReason ?? "error",
		};
	}

	private statusFromStopReason(reason: LoopStopReason): LoopStatus {
		switch (reason) {
			case "goal-achieved":
				return "completed";
			case "human-takeover":
				return "human-takeover";
			case "max-iterations":
			case "max-cost":
			case "max-duration":
				return "budget-exhausted";
			default:
				return "failed";
		}
	}

	private extractHostname(url: string): string {
		try {
			return new URL(url).hostname;
		} catch { // Ignored: non-fatal error
			return "unknown";
		}
	}

	// ─── Event Handlers ────────────────────────────────────────────────────

	private readonly handleStateChanged = (_data: unknown): void => {
		// state change tracking for future use (e.g. reactive decisions)
	};

	private readonly handleHumanTakeoverRequested = (data: unknown): void => {
		if (!this.state) return;
		this.state.status = "human-takeover";
		this.state.stopReason = "human-takeover";
		this.abortController?.abort();
	};
}
