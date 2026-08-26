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

export interface VisualQuestionPayload {
	id: string;
	question: string;
	image: { format: ScreenshotFormat; data: string };
}

export type VisualEmitter = (payload: VisualQuestionPayload) => void;

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

/** Standalone emit function. Controller-bound perception uses a scoped emitter. */
let emitVisual: VisualEmitter | null = null;
/** Weak ownership keeps controller/session routing isolated without retaining dead collectors. */
const scopedVisualEmitters = new WeakMap<object, VisualEmitter>();

export function setVisualEmitter(fn: VisualEmitter | null): void {
	emitVisual = fn;
}

export function setScopedVisualEmitter(owner: object, emitter: VisualEmitter): void {
	scopedVisualEmitters.set(owner, emitter);
}

export function getScopedVisualEmitter(owner: object): VisualEmitter | undefined {
	return scopedVisualEmitters.get(owner);
}

/**
 * Ask a visual question. Emits `visualQuestion` event and waits for
 * `resolveVisual()` to be called, or falls back to a registered VisualReasoner.
 *
 * @param screenshot PNG screenshot buffer
 * @param question  Natural language question
 * @param timeoutMs Max wait for agent response (default: 15000)
 * @param emitter   Optional scoped emitter. Falls back to the standalone emitter.
 */
export async function askVisual(
	screenshot: Buffer,
	question: string,
	timeoutMs = 15_000,
	emitter?: VisualEmitter,
): Promise<string | null> {
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

	// Prefer a session-scoped emitter; retain the global emitter for standalone API use.
	const activeEmitter = emitter ?? emitVisual;
	if (activeEmitter) {
		activeEmitter({ id, question, image: { format: screenshotFormat, data: imageData } });
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
