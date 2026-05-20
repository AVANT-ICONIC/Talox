/**
 * @file VisualReasoner.ts
 * @description Pluggable visual reasoning interface for Talox.
 *
 * Talox can capture screenshots but cannot answer visual questions natively.
 * A `VisualReasoner` is an optional plugin that takes a screenshot buffer
 * and a natural-language question, then returns an answer.
 *
 * ## No dependencies
 *
 * This module ships with **zero** VLM dependencies. The default is a no-op.
 * Install a reasoner separately:
 *
 * ```ts
 * // OpenAI Vision
 * import { createOpenAIVisionReasoner } from "talox-vlm-openai";
 * talox.useVision(createOpenAIVisionReasoner({ apiKey: "..." }));
 *
 * // Custom
 * talox.useVision({
 *   name: "my-vlm",
 *   analyze: async (screenshot, question) => answer,
 * });
 * ```
 *
 * ## How it's used
 *
 * The autonomous loop calls `perception.ask("What is on this page?")` after
 * navigation. If a reasoner is registered, the screenshot is passed to the VLM.
 * If not, it returns null and the agent falls back to AX-tree analysis.
 */

import type { Buffer } from "node:buffer";
import { createLogger } from "./Logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisualReasoner {
	readonly name: string;

	/**
	 * Analyze a screenshot and answer a natural-language question.
	 * Returns null if analysis failed or is unsupported.
	 *
	 * @param screenshot PNG buffer from `page.screenshot()`
	 * @param question   Natural language question about the page
	 * @returns Answer string, or null if unavailable
	 */
	analyze(screenshot: Buffer, question: string): Promise<string | null>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const log = createLogger("Vision");

let currentReasoner: VisualReasoner | null = null;

/** Register a visual reasoner. Replaces any previously registered reasoner. */
export function setVisualReasoner(reasoner: VisualReasoner | null): void {
	currentReasoner = reasoner;
	if (reasoner) {
		log.info(`Visual reasoner set: ${reasoner.name}`);
	} else {
		log.info("Visual reasoner cleared");
	}
}

/** Get the current visual reasoner, or null if none registered. */
export function getVisualReasoner(): VisualReasoner | null {
	return currentReasoner;
}

/**
 * Ask a visual question. Returns null if no reasoner is registered or it fails.
 */
export async function askVisual(screenshot: Buffer, question: string): Promise<string | null> {
	if (!currentReasoner) return null;

	try {
		const start = Date.now();
		const answer = await currentReasoner.analyze(screenshot, question);
		if (answer !== null) {
			log.info(`${currentReasoner.name} answered in ${Date.now() - start}ms: "${question}" → "${answer.slice(0, 80)}..."`);
		}
		return answer;
	} catch (err) {
		log.error(`Visual reasoner error: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}
