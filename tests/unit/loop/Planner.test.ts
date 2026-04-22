import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMPlanner } from "../../../src/core/loop/Planner.js";
import type { PlannerInput, TaskPlan } from "../../../src/core/loop/types.js";

// ── Mock Factories ──────────────────────────────────────────────────────────

const { mockFetch, makePlanResponse, makeInput } = vi.hoisted(() => {
	const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

	function makePlanResponse(overrides: Partial<TaskPlan> = {}): string {
		const plan: TaskPlan = {
			assessment: "Page loaded successfully",
			steps: [
				{
					index: 0,
					action: "Click the search button",
					tool: "click",
					args: { selector: "#search" },
					reasoning: "Need to find the search input",
					retryable: true,
				},
			],
			goalAchieved: false,
			...overrides,
		};
		return JSON.stringify(plan);
	}

	function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
		return {
			state: {
				url: "https://example.com/page",
				title: "Example Page",
				timestamp: "2026-04-20T12:00:00.000Z",
				interactiveElements: ["button#search", "input#email", "a.link-home"],
				consoleErrors: [],
				bugs: [],
			},
			goal: {
				description: "Find the contact page",
				startUrl: "https://example.com",
				maxIterations: 10,
			},
			recentIterations: [],
			skillsContext: "",
			...overrides,
		};
	}

	return { mockFetch, makePlanResponse, makeInput };
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("LLMPlanner", () => {
	let planner: LLMPlanner;

	beforeEach(() => {
		vi.stubGlobal("fetch", mockFetch);
		mockFetch.mockReset();
		planner = new LLMPlanner({ model: "test-model", apiKey: "test-key" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function mockFetchResponse(body: string, status = 200): void {
		mockFetch.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? "OK" : "Error",
			json: async () => JSON.parse(body),
		} as Response);
	}

	it("builds correct API request and parses response", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const result = await planner.plan(makeInput());

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(options.method).toBe("POST");
		expect(options.headers).toHaveProperty("Authorization", "Bearer test-key");

		const body = JSON.parse(options.body as string);
		expect(body.model).toBe("test-model");
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1].role).toBe("user");

		expect(result.assessment).toBe("Page loaded successfully");
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0].tool).toBe("click");
		expect(result.goalAchieved).toBe(false);
	});

	it("handles malformed LLM response gracefully", async () => {
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: "this is not valid JSON {{{" } }],
			}),
		);

		const result = await planner.plan(makeInput());

		expect(result.assessment).toBe("Failed to parse LLM response");
		expect(result.steps).toHaveLength(0);
		expect(result.goalAchieved).toBe(false);
		expect(result.blocker).toBeDefined();
		expect(result.blocker?.type).toBe("unknown");
	});

	it("handles API 429 error", async () => {
		mockFetchResponse("{}", 429);

		const result = await planner.plan(makeInput());

		expect(result.assessment).toBe("Planner failed to produce a plan");
		expect(result.blocker?.type).toBe("unknown");
	});

	it("handles API 500 error", async () => {
		mockFetchResponse("{}", 500);

		const result = await planner.plan(makeInput());

		expect(result.assessment).toBe("Planner failed to produce a plan");
		expect(result.blocker?.type).toBe("unknown");
	});

	it("builds user message with state, goal, and skills context", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const input = makeInput({
			skillsContext: "For example.com: use the sidebar for navigation",
			state: {
				url: "https://example.com/docs",
				title: "Documentation",
				timestamp: "2026-04-20T12:00:00.000Z",
				interactiveElements: ["a.sidebar-link", "button#theme-toggle"],
				consoleErrors: ["Uncaught TypeError"],
				bugs: [{ type: "layout", severity: "low", description: "Footer overlaps content" }],
			},
		});

		await planner.plan(input);

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const userMessage = body.messages[1].content as string;

		expect(userMessage).toContain("Find the contact page");
		expect(userMessage).toContain("https://example.com");
		expect(userMessage).toContain("https://example.com/docs");
		expect(userMessage).toContain("Documentation");
		expect(userMessage).toContain("a.sidebar-link");
		expect(userMessage).toContain("Uncaught TypeError");
		expect(userMessage).toContain("Footer overlaps content");
		expect(userMessage).toContain("For example.com: use the sidebar for navigation");
	});

	it("includes recent iterations in context", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const input = makeInput({
			recentIterations: [
				{
					iteration: 1,
					observation: "Page loaded, saw login form",
					plan: {
						assessment: "Need to navigate",
						steps: [],
						goalAchieved: false,
					},
					result: {
						status: "success",
						durationMs: 1200,
					},
					timestamp: "2026-04-20T12:00:01.000Z",
				},
				{
					iteration: 2,
					observation: "Clicked login, got error",
					plan: {
						assessment: "Login failed",
						steps: [],
						goalAchieved: false,
					},
					result: {
						status: "failed",
						error: "Invalid credentials",
						durationMs: 800,
					},
					timestamp: "2026-04-20T12:00:05.000Z",
				},
			],
		});

		await planner.plan(input);

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const userMessage = body.messages[1].content as string;

		expect(userMessage).toContain("Recent Iterations (2)");
		expect(userMessage).toContain("Iteration 1");
		expect(userMessage).toContain("Page loaded, saw login form");
		expect(userMessage).toContain("Iteration 2");
		expect(userMessage).toContain("Invalid credentials");
	});

	it("includes challenge state when detected", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const input = makeInput({
			challengeState: {
				hasChallenge: true,
				challenges: [],
				primaryChallenge: {
					type: "captcha",
					confidence: 0.95,
					evidence: ["hCaptcha iframe detected"],
					canRetry: false,
					requiresHuman: true,
				},
				timestamp: "2026-04-20T12:00:00.000Z",
				url: "https://example.com/verify",
			},
		});

		await planner.plan(input);

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const userMessage = body.messages[1].content as string;

		expect(userMessage).toContain("Active Challenge");
		expect(userMessage).toContain("captcha");
		expect(userMessage).toContain("hCaptcha iframe detected");
	});

	it("includes domain hints when provided", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const input = makeInput({
			domainHints: "example.com uses React SPA, forms are dynamically loaded",
		});

		await planner.plan(input);

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const userMessage = body.messages[1].content as string;

		expect(userMessage).toContain("Domain Memory Hints");
		expect(userMessage).toContain("example.com uses React SPA");
	});

	it("trims interactive elements to 30", async () => {
		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		const elements = Array.from({ length: 50 }, (_, i) => `div.el-${i}`);
		const input = makeInput({
			state: {
				url: "https://example.com",
				title: "Big Page",
				timestamp: "2026-04-20T12:00:00.000Z",
				interactiveElements: elements,
				consoleErrors: [],
				bugs: [],
			},
		});

		await planner.plan(input);

		const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
		const userMessage = body.messages[1].content as string;

		// Should contain element indices 0-29, but NOT 30+
		expect(userMessage).toContain("div.el-0");
		expect(userMessage).toContain("div.el-29");
		expect(userMessage).not.toContain("div.el-30");
		expect(userMessage).toContain("Interactive Elements (30/50)");
	});

	it("uses custom config values", async () => {
		const customPlanner = new LLMPlanner({
			model: "custom-model",
			apiBaseUrl: "https://custom.api/v1",
			apiKey: "custom-key",
			maxTokens: 1024,
			contextWindowIterations: 3,
		});

		const llmContent = makePlanResponse();
		mockFetchResponse(
			JSON.stringify({
				choices: [{ message: { content: llmContent } }],
			}),
		);

		await customPlanner.plan(makeInput());

		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://custom.api/v1/chat/completions");
		expect(options.headers).toHaveProperty("Authorization", "Bearer custom-key");

		const body = JSON.parse(options.body as string);
		expect(body.model).toBe("custom-model");
		expect(body.max_tokens).toBe(1024);
	});
});
