// src/core/loop/Planner.ts

import type {
	DynamicSkill,
	MultiAgentPlannerContext,
	PlannerConfig,
	PlannerInput,
	SkillGenerationInput,
	TaskPlan,
} from "./types.js";

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous browser agent that plans the next actions to achieve a user goal.
Analyze the current page state and decide what to do next.

Respond ONLY with valid JSON matching this schema:
{
  "assessment": "Brief assessment of current progress",
  "steps": [{ "index": 0, "action": "description", "tool": "toolName", "args": {}, "reasoning": "why", "retryable": true }],
  "goalAchieved": false,
  "blocker": null
}

If blocked, set "blocker": { "type": "...", "confidence": 0.8, "description": "...", "evidence": [], "autoResolvable": false }.
Be specific with selectors and concise with reasoning.`; // NOSONAR: long string literal is intentional

export interface Planner {
	plan(input: PlannerInput): Promise<TaskPlan>;
	generateSkill?(input: SkillGenerationInput): Promise<DynamicSkill | null>;
}

export class LLMPlanner implements Planner {
	private readonly config: Required<PlannerConfig>;

	constructor(config: PlannerConfig) {
		this.config = {
			apiBaseUrl: config.apiBaseUrl ?? "https://openrouter.ai/api/v1",
			apiKey: config.apiKey ?? process.env.OPENAI_API_KEY ?? "",
			model: config.model,
			maxTokens: config.maxTokens ?? 2048,
			systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
			contextWindowIterations: config.contextWindowIterations ?? 5,
		};
	}

	async plan(input: PlannerInput): Promise<TaskPlan> {
		try {
			const userMessage = this.buildUserMessage(input);
			const raw = await this.callLLM(userMessage);
			return this.parsePlan(raw);
		} catch {
			return {
				assessment: "Planner failed to produce a plan",
				steps: [],
				goalAchieved: false,
				blocker: {
					type: "unknown",
					confidence: 1,
					description: "LLM call or parsing failed",
					evidence: [],
					autoResolvable: false,
				},
			};
		}
	}

	async generateSkill(input: SkillGenerationInput): Promise<DynamicSkill | null> {
		const skillPrompt = `You are a browser automation skill generator. Given a blocker the agent encountered, generate a reusable skill as valid JSON.

Respond ONLY with:
{
  "name": "kebab-case-skill-name",
  "description": "What this skill does",
  "content": "# Skill Title\\n\\n## Trigger\\nWhen to use this skill.\\n\\n## Steps\\n1. Step-by-step instructions.",
  "triggerCondition": "Description of when to apply this skill",
  "toolUsage": ["tool1", "tool2"],
  "version": "1.0"
}

Blocker type: ${input.blockerType}
Description: ${input.blockerDescription}
Evidence: ${input.evidence.join("; ") || "none"}
Suggested approach: ${input.suggestedApproach || "none"}

Recent iterations:
${input.recentHistory}

Generate a skill that would help the agent overcome this blocker in future runs.`;

		try {
			const raw = await this.callLLM(skillPrompt);
			const parsed = JSON.parse(raw) as Record<string, unknown>;

			return {
				name: typeof parsed.name === "string" ? parsed.name : `skill-${input.blockerType}`,
				description: typeof parsed.description === "string" ? parsed.description : input.blockerDescription,
				domain: "auto-generated",
				version: typeof parsed.version === "string" ? parsed.version : "1.0",
				content:
					typeof parsed.content === "string" ? parsed.content : `# ${input.blockerType}\n\n${input.suggestedApproach}`,
				triggerCondition:
					typeof parsed.triggerCondition === "string"
						? parsed.triggerCondition
						: `blocker type == "${input.blockerType}"`,
				toolUsage: Array.isArray(parsed.toolUsage) ? (parsed.toolUsage as string[]) : [],
			};
		} catch {
			// Ignored: non-fatal error
			return null;
		}
	}

	private buildUserMessage(input: PlannerInput): string {
		const { state, goal, recentIterations, skillsContext, challengeState, domainHints, multiAgent } = input;
		const parts: string[] = [];

		// Goal
		parts.push(`## Goal\n${goal.description}`);
		if (goal.startUrl) {
			parts.push(`Start URL: ${goal.startUrl}`);
		}

		// Current page state
		parts.push(`\n## Current Page State`);
		parts.push(`URL: ${state.url}`);
		parts.push(`Title: ${state.title}`);

		this.appendInteractiveElements(parts, state.interactiveElements);
		this.appendConsoleErrors(parts, state.consoleErrors);
		this.appendBugs(parts, state.bugs);
		this.appendChallengeState(parts, challengeState);
		this.appendSkillsAndHints(parts, skillsContext, domainHints);
		this.appendMultiAgentContext(parts, multiAgent);
		this.appendRecentIterations(parts, recentIterations);

		return parts.join("\n");
	}

	private appendInteractiveElements(parts: string[], elements?: any[]): void {
		if (elements?.length) {
			const MAX_INTERACTIVE_ELEMENTS = 30;
			const trimmed = elements.slice(0, MAX_INTERACTIVE_ELEMENTS);
			parts.push(`Interactive Elements (${trimmed.length}/${elements.length}):`);
			for (const el of trimmed) {
				parts.push(`  - ${el}`);
			}
		}
	}

	private appendConsoleErrors(parts: string[], errors?: string[]): void {
		if (errors?.length) {
			parts.push(`Console Errors: ${errors.join("; ")}`);
		}
	}

	private appendBugs(parts: string[], bugs?: Array<{ severity: string; type: string; description: string }>): void {
		if (bugs?.length) {
			parts.push("Bugs:");
			for (const bug of bugs) {
				parts.push(`  - [${bug.severity}] ${bug.type}: ${bug.description}`);
			}
		}
	}

	private appendChallengeState(parts: string[], challengeState?: any): void {
		if (challengeState?.hasChallenge && challengeState.primaryChallenge) {
			const ch = challengeState.primaryChallenge;
			parts.push(`\n## Active Challenge`);
			parts.push(`Type: ${ch.type} (confidence: ${ch.confidence})`);
			parts.push(`Evidence: ${ch.evidence.join(", ")}`);
			parts.push(`Can retry: ${ch.canRetry}, Requires human: ${ch.requiresHuman}`);
		}
	}

	private appendSkillsAndHints(parts: string[], skillsContext?: string, domainHints?: string): void {
		if (skillsContext) {
			parts.push(`\n## Skills Context\n${skillsContext}`);
		}
		if (domainHints) {
			parts.push(`\n## Domain Memory Hints\n${domainHints}`);
		}
	}

	private appendMultiAgentContext(parts: string[], context?: MultiAgentPlannerContext): void {
		if (!context) return;

		parts.push(`\n## Multi-Agent Coordination`);
		parts.push(`You are planning coordination wave ${context.wave} for ${context.agentCount} browser agents.`);
		parts.push("Return multiple independent steps when parallel work is useful.");
		parts.push(`Every executable step must set args.agentId to an integer from 0 to ${context.agentCount - 1}.`);
		parts.push("Use args.resultKey only when a task result should be retained in shared state for later waves.");
		parts.push("Supported tools in coordinated waves: navigate, click, type, getState, screenshot, wait.");
		parts.push("Tasks assigned to different agents run concurrently; tasks assigned to the same agent run sequentially.");
		parts.push("After this wave you will receive fresh agent states, ordered task results, shared state, and merge conflicts, then you can replan.");

		if (context.agents.length > 0) {
			parts.push("Agent states:");
			for (const agent of context.agents) {
				const status = agent.lastTaskSucceeded === undefined ? "unknown" : agent.lastTaskSucceeded ? "success" : "failed";
				parts.push(`  - agent ${agent.agentId}: url=${agent.url ?? "unknown"}, title=${agent.title ?? "unknown"}, lastTask=${status}`);
			}
		}

		const sharedState = this.compactJson(context.sharedState, 5000);
		parts.push(`Shared state: ${sharedState}`);

		if (context.conflicts.length > 0) {
			parts.push("Previous merge conflicts:");
			for (const conflict of context.conflicts.slice(-10)) {
				parts.push(
					`  - key=${conflict.key}, strategy=${conflict.strategy}, accepted=${conflict.accepted}, agent=${conflict.agentId ?? "unknown"}`,
				);
			}
		}

		if (context.recentWaves.length > 0) {
			parts.push("Recent coordination waves:");
			for (const wave of context.recentWaves.slice(-this.config.contextWindowIterations)) {
				parts.push(
					`  - wave ${wave.wave}: ${wave.assessment} | successes=${wave.successes}, failures=${wave.failures}, conflicts=${wave.conflicts}`,
				);
			}
		}
	}

	private compactJson(value: unknown, maxChars: number): string {
		try {
			const json = JSON.stringify(value);
			if (json.length <= maxChars) return json;
			return `${json.slice(0, maxChars)}…`;
		} catch {
			return "[unserializable]";
		}
	}

	private appendRecentIterations(parts: string[], recentIterations: any[]): void {
		if (recentIterations.length > 0) {
			const recentSlice = recentIterations.slice(-this.config.contextWindowIterations);
			parts.push(`\n## Recent Iterations (${recentSlice.length})`);
			for (const iter of recentSlice) {
				parts.push(`Iteration ${iter.iteration}: status=${iter.result.status}, duration=${iter.result.durationMs}ms`);
				parts.push(`  Observation: ${iter.observation}`);
				if (iter.result.error) {
					parts.push(`  Error: ${iter.result.error}`);
				}
			}
		}
	}

	private async callLLM(userMessage: string): Promise<string> {
		const url = `${this.config.apiBaseUrl}/chat/completions`;

		const response = await globalThis.fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify({
				model: this.config.model,
				messages: [
					{ role: "system", content: this.config.systemPrompt },
					{ role: "user", content: userMessage },
				],
				max_tokens: this.config.maxTokens,
				temperature: 0.2,
			}),
		});

		if (!response.ok) {
			throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
		}

		const data = (await response.json()) as {
			choices: Array<{ message: { content: string } }>;
		};

		return data.choices[0]?.message?.content ?? "";
	}

	private parsePlan(raw: string): TaskPlan {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;

			const result: TaskPlan = {
				assessment: typeof parsed.assessment === "string" ? parsed.assessment : "",
				steps: Array.isArray(parsed.steps) ? (parsed.steps as TaskPlan["steps"]) : [],
				goalAchieved: typeof parsed.goalAchieved === "boolean" ? parsed.goalAchieved : false,
			};
			const blocker = parsed.blocker;
			if (blocker != null && typeof blocker === "object" && !Array.isArray(blocker)) {
				// NOSONAR: intentional null check
				result.blocker = blocker as NonNullable<TaskPlan["blocker"]>;
			}
			return result;
		} catch {
			return {
				assessment: "Failed to parse LLM response",
				steps: [],
				goalAchieved: false,
				blocker: {
					type: "unknown",
					confidence: 1,
					description: "Could not parse LLM response as JSON",
					evidence: [raw.slice(0, 200)],
					autoResolvable: false,
				},
			};
		}
	}
}
