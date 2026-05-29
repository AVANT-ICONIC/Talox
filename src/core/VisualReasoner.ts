/**
 * @file VisualReasoner.ts
 * @description Visual reasoning for Talox — event-based, agent-first.
 *
 * Talox is middleware. The hosting agent (Claude Code, Codex, Gemini CLI)
 * already has vision. Talox emits a `visualQuestion` event with a screenshot
 * and the agent resolves it using its own vision.
 *
 * ## Flow
 *
 * 1. Talox needs visual analysis → calls `askVisual(screenshot, question)`
 * 2. Emits `visualQuestion` event with { id, question, image }
 * 3. Agent receives event, uses its own vision → calls `resolveVisual(id, answer)`
 * 4. Talox returns the answer
 *
 * If no agent responds within `timeoutMs`, falls back to a registered
 * `VisualReasoner` plugin (OpenAI Vision, local VLM, etc.).
 *
 * ## Agent integration
 *
 * ```ts
 * talox.on("visualQuestion", async ({ id, question, image }) => {
 *   // Use your agent's vision (Claude, GPT-4o, Gemini)
 *   const answer = await yourVisionModel(image.data, question);
 *   talox.resolveVisual(id, answer);
 * });
 * ```
 *
 * ## Standalone fallback
 *
 * ```ts
 * import { createOpenAIVisionReasoner } from "talox";
 * talox.useVision(createOpenAIVisionReasoner({ apiKey: "..." }));
 * // No agent needed — Talox calls OpenAI Vision directly as fallback
 * ```
 */

import type { Buffer } from "node:buffer";
import { createLogger } from "./Logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisualReasoner {
	readonly name: string;
	analyze(screenshot: Buffer, question: string): Promise<string | null>;
}

export interface OpenAIVisionConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	maxTokens?: number;
}

// ─── Screenshot Format ───────────────────────────────────────────────────────

export type ScreenshotFormat = "base64" | "file" | "buffer";

let screenshotFormat: ScreenshotFormat = "base64";

export function setScreenshotFormat(format: ScreenshotFormat): void {
	screenshotFormat = format;
}

export function getScreenshotFormat(): ScreenshotFormat {
	return screenshotFormat;
}

// ─── Event-based Resolution ──────────────────────────────────────────────────

const log = createLogger("Vision");

interface PendingQuestion {
	resolve: (answer: string | null) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingQuestion>();

/** Emit function — set by TaloxController when EventBus is ready. */
let emitVisual:
	| ((payload: { id: string; question: string; image: { format: ScreenshotFormat; data: string } }) => void)
	| null = null;

export function setVisualEmitter(fn: typeof emitVisual): void {
	emitVisual = fn;
}

/**
 * Ask a visual question. Emits `visualQuestion` event and waits for
 * `resolveVisual()` to be called, or falls back to a registered VisualReasoner.
 *
 * @param screenshot PNG screenshot buffer
 * @param question  Natural language question
 * @param timeoutMs Max wait for agent response (default: 15000)
 */
export async function askVisual(screenshot: Buffer, question: string, timeoutMs = 15_000): Promise<string | null> {
	const id = `vis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	// Format the image
	let imageData: string;
	if (screenshotFormat === "base64") {
		imageData = `data:image/png;base64,${screenshot.toString("base64")}`;
	} else if (screenshotFormat === "buffer") {
		imageData = screenshot.toString("base64");
	} else {
		// file format — not implemented yet, fall back to base64
		imageData = `data:image/png;base64,${screenshot.toString("base64")}`;
	}

	// Create a promise that resolves when resolveVisual() is called
	const promise = new Promise<string | null>((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve(null); // Timeout — will trigger fallback
		}, timeoutMs);

		pending.set(id, { resolve, timer });
	});

	// Emit the event for the hosting agent
	if (emitVisual) {
		emitVisual({ id, question, image: { format: screenshotFormat, data: imageData } });
		log.info(`Visual question emitted: "${question.slice(0, 60)}..." (timeout: ${timeoutMs}ms)`);
	}

	// Wait for agent response
	const agentAnswer = await promise;

	if (agentAnswer !== null) {
		log.info(`Agent resolved visual question in time`);
		return agentAnswer;
	}

	// Fallback: try registered VisualReasoner
	log.info("Agent did not respond — trying registered VisualReasoner fallback");
	return askVisualFallback(screenshot, question);
}

/**
 * Resolve a pending visual question.
 * Called by the hosting agent after it processes the screenshot.
 */
export function resolveVisual(id: string, answer: string): void {
	const entry = pending.get(id);
	if (!entry) {
		log.warn(`resolveVisual called for unknown id: ${id}`);
		return;
	}

	clearTimeout(entry.timer);
	pending.delete(id);
	entry.resolve(answer);
}

// ─── VisualReasoner Fallback ─────────────────────────────────────────────────

let currentReasoner: VisualReasoner | null = null;

export function setVisualReasoner(reasoner: VisualReasoner | null): void {
	currentReasoner = reasoner;
	if (reasoner) {
		log.info(`Visual reasoner set: ${reasoner.name}`);
	} else {
		log.info("Visual reasoner cleared");
	}
}

export function getVisualReasoner(): VisualReasoner | null {
	return currentReasoner;
}

async function askVisualFallback(screenshot: Buffer, question: string): Promise<string | null> {
	if (!currentReasoner) return null;

	try {
		const start = Date.now();
		const answer = await currentReasoner.analyze(screenshot, question);
		if (answer !== null) {
			log.info(`${currentReasoner.name} answered in ${Date.now() - start}ms`);
		}
		return answer;
	} catch (err) {
		log.error(`Fallback reasoner error: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

// ─── Built-in Provider: OpenAI Vision ───────────────────────────────────────

export function createOpenAIVisionReasoner(config: OpenAIVisionConfig): VisualReasoner {
	const baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
	const model = config.model ?? "gpt-4o-mini";
	const maxTokens = config.maxTokens ?? 300;

	return {
		name: `OpenAI Vision (${model})`,

		async analyze(screenshot, question) {
			const base64 = screenshot.toString("base64");

			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.apiKey}`,
				},
				body: JSON.stringify({
					model,
					max_tokens: maxTokens,
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: question },
								{
									type: "image_url",
									image_url: { url: `data:image/png;base64,${base64}`, detail: "low" },
								},
							],
						},
					],
				}),
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
			}

			const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
			return data.choices[0]?.message?.content?.trim() ?? null;
		},
	};
}
