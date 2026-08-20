import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMPlanner } from "../../src/core/loop/Planner.js";
import type { PlannerInput } from "../../src/core/loop/types.js";

function makeState(): PlannerInput["state"] {
	return {
		url: "https://example.com",
		title: "Example",
		interactiveElements: [],
		consoleErrors: [],
		bugs: [],
	} as PlannerInput["state"];
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("LLMPlanner multi-agent context", () => {
	it("injects coordination rules, agent states, shared state, conflicts, and recent waves into the user prompt", async () => {
		let userPrompt = "";
		const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body ?? "{}")) as {
				messages?: Array<{ role: string; content: string }>;
			};
			userPrompt = payload.messages?.find((message) => message.role === "user")?.content ?? "";

			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									assessment: "done",
									steps: [],
									goalAchieved: true,
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const planner = new LLMPlanner({
			model: "test-model",
			apiKey: "test-key",
			apiBaseUrl: "https://planner.example/v1",
		});

		const input: PlannerInput = {
			state: makeState(),
			goal: {
				description: "Compare two sources",
				maxIterations: 4,
			},
			recentIterations: [],
			skillsContext: "",
			multiAgent: {
				agentCount: 2,
				wave: 3,
				sharedState: { sourceA: "captured", phase: "compare" },
				agents: [
					{ agentId: 0, url: "https://a.example", title: "A", lastTaskSucceeded: true },
					{ agentId: 1, url: "https://b.example", title: "B", lastTaskSucceeded: false },
				],
				conflicts: [{ key: "winner", strategy: "reject", accepted: false, agentId: 1 }],
				recentWaves: [
					{
						wave: 2,
						assessment: "Collected both sources",
						successes: 2,
						failures: 0,
						conflicts: 1,
					},
				],
			},
		};

		const result = await planner.plan(input);

		expect(result.goalAchieved).toBe(true);
		expect(userPrompt).toContain("## Multi-Agent Coordination");
		expect(userPrompt).toContain("coordination wave 3 for 2 browser agents");
		expect(userPrompt).toContain("args.agentId");
		expect(userPrompt).toContain("agent 0: url=https://a.example");
		expect(userPrompt).toContain("agent 1: url=https://b.example");
		expect(userPrompt).toContain('"sourceA":"captured"');
		expect(userPrompt).toContain("key=winner, strategy=reject, accepted=false, agent=1");
		expect(userPrompt).toContain("wave 2: Collected both sources");
	});

	it("caps shared-state serialization so planner context cannot grow without bound", async () => {
		let userPrompt = "";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
				const payload = JSON.parse(String(init?.body ?? "{}")) as {
					messages?: Array<{ role: string; content: string }>;
				};
				userPrompt = payload.messages?.find((message) => message.role === "user")?.content ?? "";
				return new Response(
					JSON.stringify({
						choices: [{ message: { content: '{"assessment":"ok","steps":[],"goalAchieved":true}' } }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}),
		);

		const planner = new LLMPlanner({ model: "test", apiKey: "x", apiBaseUrl: "https://planner.example/v1" });
		await planner.plan({
			state: makeState(),
			goal: { description: "Bound context", maxIterations: 2 },
			recentIterations: [],
			skillsContext: "",
			multiAgent: {
				agentCount: 1,
				wave: 1,
				sharedState: { huge: "x".repeat(20_000) },
				agents: [{ agentId: 0 }],
				conflicts: [],
				recentWaves: [],
			},
		});

		const sharedLine = userPrompt.split("\n").find((line) => line.startsWith("Shared state:"));
		expect(sharedLine).toBeDefined();
		expect(sharedLine?.length ?? 0).toBeLessThan(5_100);
		expect(sharedLine).toContain("…");
	});
});
