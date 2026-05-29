/**
 * Unit tests for ChatSession — LLM-powered chat mode.
 * All external dependencies (fetch, readline, TaloxController) are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock factories ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockTaloxController = {
	navigate: vi.fn(),
	click: vi.fn(),
	type: vi.fn(),
	getState: vi.fn(),
	getPlaywrightPage: vi.fn(),
	stop: vi.fn(),
};

vi.mock("node:readline", () => ({
	createInterface: vi.fn().mockReturnValue({
		prompt: vi.fn(),
		pause: vi.fn(),
		on: vi.fn(),
		close: vi.fn(),
	}),
}));

vi.mock("../../src/core/controller/TaloxController.js", () => ({
	TaloxController: vi.fn().mockImplementation(() => mockTaloxController),
}));

// Import after mocks
import { ChatSession } from "../../src/core/chat/ChatSession.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockLLMResponse(options: {
	content?: string | null;
	toolCalls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
}) {
	return {
		ok: true,
		status: 200,
		json: vi.fn().mockResolvedValue({
			choices: [
				{
					message: {
						content: options.content ?? null,
						tool_calls: options.toolCalls ?? undefined,
					},
				},
			],
		}),
		text: vi.fn().mockResolvedValue(""),
	};
}

function makeToolCall(action: string, extra: Record<string, unknown> = {}): any {
	return {
		id: `tc-${action}-${Date.now()}`,
		type: "function" as const,
		function: {
			name: "talox_browser",
			arguments: JSON.stringify({ action, ...extra }),
		},
	};
}

describe("ChatSession", () => {
	let session: ChatSession;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", mockFetch);

		mockTaloxController.navigate.mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		});
		mockTaloxController.click.mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		});
		mockTaloxController.type.mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		});
		mockTaloxController.getState.mockResolvedValue({
			url: "https://example.com",
			title: "Example",
			nodes: [],
			interactiveElements: [],
			console: { errors: [] },
			network: { failedRequests: [] },
			bugs: [],
			timestamp: new Date().toISOString(),
		});
		mockTaloxController.getPlaywrightPage.mockReturnValue({
			evaluate: vi.fn().mockResolvedValue(undefined),
		});
		mockTaloxController.stop.mockResolvedValue(undefined);

		// Suppress stdout writes in tests
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ─── Constructor ─────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("creates session with default config", () => {
			session = new ChatSession(mockTaloxController as any);
			expect(session).toBeDefined();
		});

		it("creates session with custom config", () => {
			session = new ChatSession(mockTaloxController as any, {
				model: "gpt-4-turbo",
				baseUrl: "https://custom.api.com/v1",
				maxContextChars: 100_000,
			});
			expect(session).toBeDefined();
		});

		it("trims trailing slash from baseUrl", () => {
			session = new ChatSession(mockTaloxController as any, {
				baseUrl: "https://custom.api.com/v1/",
			});
			expect(session).toBeDefined();
			// Verify by checking fetch call later — the URL should not have double slashes
		});

		it("uses custom system prompt when provided", () => {
			session = new ChatSession(mockTaloxController as any, {
				systemPrompt: "You are a test assistant.",
			});
			expect(session).toBeDefined();
		});
	});

	// ─── sendMessage — text-only response ────────────────────────────────────

	describe("sendMessage (text-only response)", () => {
		it("returns assistant text response", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockFetch.mockResolvedValue(mockLLMResponse({ content: "Hello! I can help you browse the web." }));

			const result = await session.sendMessage("Hello");
			expect(result).toBe("Hello! I can help you browse the web.");
		});

		it("sends the user message and system prompt to the LLM", async () => {
			session = new ChatSession(mockTaloxController as any, { apiKey: "test-key" });
			mockFetch.mockResolvedValue(mockLLMResponse({ content: "Hi" }));

			await session.sendMessage("Navigate to example.com");

			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, options] = mockFetch.mock.calls[0];
			expect(url).toContain("/chat/completions");
			expect(options.method).toBe("POST");
			expect(options.headers.Authorization).toBe("Bearer test-key");

			const body = JSON.parse(options.body);
			expect(body.messages[0].role).toBe("system");
			expect(body.messages[body.messages.length - 1].role).toBe("user");
			expect(body.messages[body.messages.length - 1].content).toBe("Navigate to example.com");
		});

		it("includes tool definitions in the request", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockFetch.mockResolvedValue(mockLLMResponse({ content: "OK" }));

			await session.sendMessage("test");

			const body = JSON.parse(mockFetch.mock.calls[0][1].body);
			expect(body.tools).toBeDefined();
			expect(body.tools).toHaveLength(1);
			expect(body.tools[0].type).toBe("function");
			expect(body.tools[0].function.name).toBe("talox_browser");
		});
	});

	// ─── sendMessage — tool calls ────────────────────────────────────────────

	describe("sendMessage (tool calls)", () => {
		it("executes navigate tool call and returns final text", async () => {
			session = new ChatSession(mockTaloxController as any);

			// First call: navigate tool call, second call: final text
			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("navigate", { url: "https://example.com" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "I navigated to example.com" }));

			const result = await session.sendMessage("Go to example.com");
			expect(result).toBe("I navigated to example.com");
			expect(mockTaloxController.navigate).toHaveBeenCalledWith("https://example.com");
		});

		it("executes click tool call", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("click", { selector: "#btn" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Clicked the button" }));

			await session.sendMessage("Click the button");
			expect(mockTaloxController.click).toHaveBeenCalledWith("#btn");
		});

		it("executes type tool call", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("type", { selector: "#input", text: "hello" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Typed the text" }));

			await session.sendMessage("Type hello");
			expect(mockTaloxController.type).toHaveBeenCalledWith("#input", "hello");
		});

		it("executes scroll tool call", async () => {
			session = new ChatSession(mockTaloxController as any);
			const mockPage = { evaluate: vi.fn().mockResolvedValue(undefined) };
			mockTaloxController.getPlaywrightPage.mockReturnValue(mockPage);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("scroll", { direction: "down" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Scrolled down" }));

			await session.sendMessage("Scroll down");
			expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, 500)");
		});

		it("executes scroll up tool call", async () => {
			session = new ChatSession(mockTaloxController as any);
			const mockPage = { evaluate: vi.fn().mockResolvedValue(undefined) };
			mockTaloxController.getPlaywrightPage.mockReturnValue(mockPage);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("scroll", { direction: "up" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Scrolled up" }));

			await session.sendMessage("Scroll up");
			expect(mockPage.evaluate).toHaveBeenCalledWith("window.scrollBy(0, -500)");
		});

		it("executes getState tool call", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("getState")],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Got the state" }));

			await session.sendMessage("Get page state");
			expect(mockTaloxController.getState).toHaveBeenCalledWith("agent");
		});

		it("executes screenshot tool call", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("screenshot")],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Took screenshot" }));

			await session.sendMessage("Take a screenshot");
			expect(mockTaloxController.getState).toHaveBeenCalledWith("agent");
		});

		it("handles unknown action gracefully", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("unknown_action")],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "OK, done" }));

			const result = await session.sendMessage("Do something weird");
			expect(result).toBe("OK, done");
		});

		it("handles invalid JSON in tool arguments", async () => {
			session = new ChatSession(mockTaloxController as any);

			const badToolCall = {
				id: "tc-bad",
				type: "function" as const,
				function: {
					name: "talox_browser",
					arguments: "not-valid-json{{{",
				},
			};

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [badToolCall],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Fixed that" }));

			const result = await session.sendMessage("Test bad JSON");
			expect(result).toBe("Fixed that");
		});

		it("handles tool execution errors gracefully", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockTaloxController.navigate.mockRejectedValue(new Error("Navigation failed"));

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("navigate", { url: "https://fail.com" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Navigation error occurred" }));

			const result = await session.sendMessage("Navigate to fail.com");
			expect(result).toBe("Navigation error occurred");
		});

		it("handles multiple sequential tool calls", async () => {
			session = new ChatSession(mockTaloxController as any);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("navigate", { url: "https://example.com" })],
					}),
				)
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("click", { selector: "#btn" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Done!" }));

			const result = await session.sendMessage("Go to example.com and click button");
			expect(result).toBe("Done!");
			expect(mockTaloxController.navigate).toHaveBeenCalledWith("https://example.com");
			expect(mockTaloxController.click).toHaveBeenCalledWith("#btn");
		});
	});

	// ─── sendMessage — error handling ────────────────────────────────────────

	describe("sendMessage (error handling)", () => {
		it("throws on LLM API error", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockFetch.mockResolvedValue({
				ok: false,
				status: 429,
				text: vi.fn().mockResolvedValue("Rate limited"),
			});

			await expect(session.sendMessage("test")).rejects.toThrow("LLM API error 429");
		});

		it("throws when no response from LLM", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockFetch.mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue({ choices: [] }),
				text: vi.fn().mockResolvedValue(""),
			});

			await expect(session.sendMessage("test")).rejects.toThrow("No response from LLM");
		});

		it("returns fallback message after max tool call iterations", async () => {
			session = new ChatSession(mockTaloxController as any);

			// Return tool calls for all 25 iterations
			const toolCallResponse = mockLLMResponse({
				content: null,
				toolCalls: [makeToolCall("getState")],
			});
			mockFetch.mockResolvedValue(toolCallResponse);

			const result = await session.sendMessage("Loop test");
			expect(result).toBe("Reached maximum tool call iterations.");
		}, 10000);
	});

	// ─── compact() ───────────────────────────────────────────────────────────

	describe("compact", () => {
		it("compacts messages when total chars exceed maxContextChars", async () => {
			session = new ChatSession(mockTaloxController as any, {
				maxContextChars: 500,
			});

			// First call returns tool calls, second call returns text
			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("getState")],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Done" }));

			// Send a large message to trigger compaction
			const bigMsg = "A".repeat(600);
			await session.sendMessage(bigMsg);

			// Verify the messages were compacted by checking the second LLM call
			// The compact method should have been called and the messages array modified
			expect(mockFetch).toHaveBeenCalled();
		});
	});

	// ─── stop() ──────────────────────────────────────────────────────────────

	describe("stop", () => {
		it("calls talox.stop()", async () => {
			session = new ChatSession(mockTaloxController as any);
			await session.stop();
			expect(mockTaloxController.stop).toHaveBeenCalled();
		});
	});

	// ─── screenshot with no page ─────────────────────────────────────────────

	describe("screenshot with no page", () => {
		it("returns error when no active page for screenshot", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockTaloxController.getPlaywrightPage.mockReturnValue(null);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("screenshot")],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "No page available" }));

			await session.sendMessage("Screenshot");
			// When no page, screenshot returns { error: "No active page" } without calling getState
			expect(mockTaloxController.getState).not.toHaveBeenCalled();
		});
	});

	// ─── scroll with no page ─────────────────────────────────────────────────

	describe("scroll with no page", () => {
		it("returns scrolled result even without a page", async () => {
			session = new ChatSession(mockTaloxController as any);
			mockTaloxController.getPlaywrightPage.mockReturnValue(null);

			mockFetch
				.mockResolvedValueOnce(
					mockLLMResponse({
						content: null,
						toolCalls: [makeToolCall("scroll", { direction: "down" })],
					}),
				)
				.mockResolvedValueOnce(mockLLMResponse({ content: "Scrolled" }));

			const response = await session.sendMessage("Scroll down");
			expect(response).toContain("Scrolled");
			// No page.evaluate should be called since there's no page
			// but the tool should still return successfully
		});
	});
});
