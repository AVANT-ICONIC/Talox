/**
 * @file ChatSession.ts
 * @description LLM-powered chat mode for Talox.
 *
 * Uses an OpenAI-compatible function calling API so an LLM can control
 * the browser through TaloxController actions in a conversational REPL.
 */

import { createInterface } from "node:readline";
import type { TaloxPageState } from "../../types/index.js";
import type { TaloxController } from "../controller/TaloxController.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatConfig {
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	maxContextChars?: number;
	systemPrompt?: string;
}

interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}

interface ToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

interface ToolFunctionDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TALOX_SYSTEM_PROMPT = `You are Talox, an AI browser assistant. You can control a web browser using the talox_browser tool.

Available actions:
- navigate(url): Go to a URL
- click(selector): Click an element matching the CSS selector
- type(selector, text): Type text into an element matching the CSS selector
- scroll(direction): Scroll the page ("up" or "down")
- screenshot(): Take a screenshot and describe what you see
- getState(): Get the current page state (URL, title, interactive elements, console errors, bugs)

Guidelines:
- Always check page state before interacting with elements.
- Use descriptive CSS selectors when clicking or typing.
- Describe what you see on the page after each action.
- If something goes wrong, try a different approach.
- Be concise but helpful.`;

const TALOX_BROWSER_TOOL: ToolFunctionDef = {
	name: "talox_browser",
	description:
		"Control the Talox browser. Available functions: navigate(url), click(selector), type(selector, text), scroll(direction), screenshot(), getState().",
	parameters: {
		type: "object",
		properties: {
			action: {
				type: "string",
				enum: ["navigate", "click", "type", "scroll", "screenshot", "getState"],
				description: "The browser action to perform.",
			},
			url: {
				type: "string",
				description: "URL to navigate to (required for navigate action).",
			},
			selector: {
				type: "string",
				description: "CSS selector of the target element (required for click, type actions).",
			},
			text: {
				type: "string",
				description: "Text to type (required for type action).",
			},
			direction: {
				type: "string",
				enum: ["up", "down"],
				description: "Scroll direction (required for scroll action).",
			},
		},
		required: ["action"],
	},
};

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * ChatSession manages a conversation between the user, an LLM, and the Talox browser.
 *
 * The LLM uses function calling to invoke browser actions. Conversation history
 * is compacted when it exceeds `maxContextChars` characters.
 */
export class ChatSession {
	private messages: ChatMessage[] = [];
	private readonly talox: TaloxController;
	private readonly config: Required<Pick<ChatConfig, "model" | "apiKey" | "baseUrl" | "maxContextChars">> & {
		systemPrompt: string;
	};

	constructor(talox: TaloxController, config?: ChatConfig) {
		this.talox = talox;

		const apiKey = config?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
		const baseUrl = config?.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";

		this.config = {
			model: config?.model ?? process.env["OPENAI_MODEL"] ?? "gpt-4o",
			apiKey,
			baseUrl: baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl,
			maxContextChars: config?.maxContextChars ?? 200_000,
			systemPrompt: config?.systemPrompt ?? TALOX_SYSTEM_PROMPT,
		};

		this.messages.push({ role: "system", content: this.config.systemPrompt });
	}

	/**
	 * Launch the browser (if not already running) and start an interactive REPL.
	 */
	async start(): Promise<void> {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
			prompt: "\x1b[36mYou> \x1b[0m",
		});

		rl.prompt();

		const handleLine = async (line: string) => {
			const input = line.trim();
			if (!input) {
				rl.prompt();
				return;
			}

			rl.pause();
			try {
				await this.sendMessage(input);
			} catch (error: unknown) {
				console.error("\x1b[31m[Chat Error]\x1b[0m", error instanceof Error ? error.message : String(error));
			}
			rl.prompt();
		};

		rl.on("line", (line: string) => {
			void handleLine(line);
		});

		rl.on("close", () => {
			void this.stop();
		});
	}

	/**
	 * Send a user message and process the LLM response (including tool calls).
	 *
	 * @returns The final assistant text response.
	 */
	async sendMessage(userMsg: string): Promise<string> {
		this.messages.push({ role: "user", content: userMsg });
		this.compact();

		let response = "";
		let iterations = 0;
		const maxIterations = 25;

		while (iterations < maxIterations) {
			iterations++;
			const data = await this.callLLM();

			if (data.tool_calls && data.tool_calls.length > 0) {
				this.messages.push({
					role: "assistant",
					content: data.content ?? "",
					tool_calls: data.tool_calls,
				});

				for (const tc of data.tool_calls) {
					const result = await this.executeToolCall(tc);
					this.messages.push({
						role: "tool",
						content: result,
						tool_call_id: tc.id,
					});
				}
			} else {
				response = data.content ?? "";
				this.messages.push({ role: "assistant", content: response });

				process.stdout.write(`\x1b[32mAssistant> \x1b[0m${response}\n\n`);
				return response;
			}
		}

		const fallback = "Reached maximum tool call iterations.";
		process.stdout.write(`\x1b[32mAssistant> \x1b[0m${fallback}\n\n`);
		return fallback;
	}

	/**
	 * Compact older messages when the total character count exceeds the threshold.
	 */
	compact(): void {
		const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
		if (totalChars <= this.config.maxContextChars) return;

		const systemMsg = this.messages[0];
		if (systemMsg?.role !== "system") return;

		const mid = Math.floor(this.messages.length / 2);
		if (mid <= 1) return;

		const summary = buildSummary(this.messages.slice(1, mid));
		this.messages = [
			systemMsg,
			{ role: "user", content: `[Earlier conversation summary]\n${summary}` },
			...this.messages.slice(mid),
		];
	}

	/**
	 * Stop the chat session and close the browser.
	 */
	async stop(): Promise<void> {
		await this.talox.stop();
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private async callLLM(): Promise<{ content: string | null; tool_calls: ToolCall[] | null }> {
		const url = `${this.config.baseUrl}/chat/completions`;

		const toolsDef = [
			{
				type: "function" as const,
				function: TALOX_BROWSER_TOOL,
			},
		];

		const body = {
			model: this.config.model,
			messages: this.messages.map((m) => ({
				role: m.role,
				content: m.content,
				...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
				...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
			})),
			tools: toolsDef,
			stream: false,
		};

		const resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.config.apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!resp.ok) {
			const text = await resp.text();
			throw new Error(`LLM API error ${resp.status}: ${text}`);
		}

		const json = (await resp.json()) as {
			choices: Array<{
				message: {
					content: string | null;
					tool_calls?: Array<{
						id: string;
						type: "function";
						function: { name: string; arguments: string };
					}>;
				};
			}>;
		};

		const choice = json.choices?.[0]?.message;
		if (!choice) {
			throw new Error("No response from LLM");
		}

		return {
			content: choice.content,
			tool_calls: choice.tool_calls ?? null,
		};
	}

	private async executeToolCall(tc: ToolCall): Promise<string> {
		let args: Record<string, unknown>;
		try {
			args = JSON.parse(tc.function.arguments);
		} catch { // NOSONAR -- non-fatal
			return `Error: Invalid JSON arguments — ${tc.function.arguments}`;
		}

		const action = String(args["action"] ?? "");

		try {
			const result = await this.runAction(action, args);
			const summary = formatActionResult(action, result);

			process.stdout.write(`\x1b[33m[Tool: ${action}]\x1b[0m ${summary.slice(0, 200)}\n`);

			return summary;
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			process.stdout.write(`\x1b[31m[Tool Error: ${action}]\x1b[0m ${msg}\n`);
			return `Error executing ${action}: ${msg}`;
		}
	}

	private async runAction(action: string, args: Record<string, unknown>): Promise<unknown> {
		switch (action) {
			case "navigate":
				return this.talox.navigate(String(args["url"] ?? ""));
			case "click":
				return this.talox.click(String(args["selector"] ?? ""));
			case "type":
				return this.talox.type(String(args["selector"] ?? ""), String(args["text"] ?? ""));
			case "scroll": {
				const direction = String(args["direction"] ?? "down");
				const page = this.talox.getPlaywrightPage();
				if (page) {
					const scrollPx = direction === "up" ? -500 : 500;
					await page.evaluate(`window.scrollBy(0, ${scrollPx})`);
				}
				return { scrolled: direction };
			}
			case "screenshot": {
				const page = this.talox.getPlaywrightPage();
				if (!page) return { error: "No active page" };
				const state = await this.talox.getState("agent");
				return state;
			}
			case "getState":
				return this.talox.getState("agent");
			default:
				return { error: `Unknown action: ${action}` };
		}
	}
}

// ─── Module-level Utilities ─────────────────────────────────────────────────

function buildSummary(messages: ChatMessage[]): string {
	const parts: string[] = [];
	for (const m of messages) {
		const preview = m.content.length > 200 ? `${m.content.slice(0, 200)}...` : m.content;
		parts.push(`[${m.role}]: ${preview}`);
	}
	return parts.join("\n");
}

function formatPageState(state: Partial<TaloxPageState>): string {
	const parts = [`URL: ${state.url}`, `Title: ${state.title ?? "N/A"}`];
	if (state.interactiveElements) {
		parts.push(`Interactive elements: ${state.interactiveElements.length}`);
	}
	if (state.console && state.console.errors.length > 0) {
		parts.push(`Console errors: ${state.console.errors.length}`);
	}
	if (state.bugs && state.bugs.length > 0) {
		parts.push(`Bugs: ${state.bugs.length}`);
	}
	return parts.join(" | ");
}

function stringifyResult(result: unknown): string {
	try {
		return JSON.stringify(result).slice(0, 500);
	} catch { /* NOSONAR */
		return String(result);
	}
}

function formatActionResult(action: string, result: unknown): string {
	if (result === null || result === undefined) {
		return `${action} completed (no return value)`;
	}

	if (typeof result === "object") {
		const state = result as Partial<TaloxPageState>;
		if (state.url !== undefined) {
			return formatPageState(state);
		}
	}

	return stringifyResult(result);
}
