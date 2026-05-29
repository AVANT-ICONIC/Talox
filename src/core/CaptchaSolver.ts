/**
 * @file CaptchaSolver.ts
 * @description CAPTCHA solving via Talox's own AI (VLM / VisualReasoner).
 *
 * Talox detects captchas via `ChallengeDetector` but cannot solve them locally.
 * This module hooks into the `VisualReasoner` plugin — when a captcha is detected,
 * Talox takes a screenshot, asks the VLM to read it, and types the answer.
 *
 * No external paid services. No dependencies. The solving is done by whatever
 * VisualReasoner you've registered (OpenAI Vision, Claude, local Moondream, etc.).
 *
 * ## Flow
 *
 * 1. Talox detects a captcha on the page
 * 2. Takes a screenshot of the captcha element (or full page)
 * 3. Calls `VisualReasoner.analyze(screenshot, "Read the captcha text...")`
 * 4. Types the answer into the input field
 * 5. Submits
 *
 * ## Custom solvers
 *
 * If you need a non-VLM solver (e.g. audio captcha, custom service),
 * implement the `CaptchaSolver` interface and call `registerSolver()`.
 */

import type { Page } from "playwright-core";
import { createLogger } from "./Logger.js";
import { getVisualReasoner } from "./VisualReasoner.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CaptchaVariant =
	| "recaptcha-v2"
	| "recaptcha-v3"
	| "hcaptcha"
	| "funcaptcha"
	| "turnstile"
	| "image-captcha"
	| "text-captcha";

export interface CaptchaChallenge {
	type: CaptchaVariant;
	sitekey: string;
	pageUrl: string;
	dataS?: string;
	invisible?: boolean;
}

export interface CaptchaSolution {
	token: string;
	solver: string;
	durationMs: number;
}

/**
 * A pluggable CAPTCHA solver.
 *
 * `detect` — identify the challenge on the page. Return null if not handled.
 * `solve`  — produce a token. Return null if solving failed.
 *
 * Talox ships with a built-in VLM-based solver that uses `VisualReasoner`.
 * Register custom solvers via `registerSolver()` for non-VLM approaches.
 */
export interface CaptchaSolver {
	readonly name: string;
	detect(page: Page): Promise<CaptchaChallenge | null>;
	solve(page: Page, challenge: CaptchaChallenge): Promise<CaptchaSolution | null>;
}

// ─── Built-in: VLM-based Solver ───────────────────────────────────────────────

const log = createLogger("Solver");

/**
 * Creates a CAPTCHA solver backed by the registered VisualReasoner (VLM).
 *
 * When a captcha is detected, this solver:
 * 1. Screenshots the captcha element (or full page as fallback)
 * 2. Asks the VLM: "Read the text in this CAPTCHA image. Reply with ONLY the characters."
 * 3. Returns the VLM's answer as the token
 *
 * Requires a VisualReasoner to be registered via `setVisualReasoner()`.
 * If no VLM is registered, this solver returns null and falls through.
 */
export function createVLMCaptchaSolver(): CaptchaSolver {
	return {
		name: "Talox VLM",

		async detect(page) {
			const url = page.url();

			// reCAPTCHA
			const recaptcha = await page.$("[data-sitekey]");
			if (recaptcha) {
				const sitekey = await recaptcha.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "recaptcha-v2", sitekey, pageUrl: url };
				}
			}

			// hCaptcha
			const hcaptcha = await page.$(".h-captcha[data-sitekey]");
			if (hcaptcha) {
				const sitekey = await hcaptcha.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "hcaptcha", sitekey, pageUrl: url };
				}
			}

			// Image captcha — look for img captcha patterns
			const captchaImg = await page.$('img[src*="captcha"], img[id*="captcha"], img[class*="captcha"]');
			if (captchaImg) {
				return { type: "image-captcha", sitekey: "image", pageUrl: url };
			}

			// Text-based captcha input (e.g. "Type the word shown above")
			const captchaInput = await page.$('input[name*="captcha"], input[id*="captcha"]');
			if (captchaInput) {
				return { type: "text-captcha", sitekey: "text", pageUrl: url };
			}

			return null;
		},

		async solve(page, challenge) {
			const reasoner = getVisualReasoner();
			if (!reasoner) {
				log.info("No VisualReasoner registered — captcha solving unavailable");
				return null;
			}

			const start = Date.now();

			try {
				// Take screenshot of the captcha element if possible
				let screenshot: Buffer;
				try {
					const captchaSelector =
						'[data-sitekey], .h-captcha, img[src*="captcha"], [id*="captcha"], [class*="captcha"]';
					const captchaEl = await page.$(captchaSelector);
					if (captchaEl) {
						screenshot = (await captchaEl.screenshot({ type: "png" })) as Buffer;
					} else {
						screenshot = (await page.screenshot({ type: "png" })) as Buffer;
					}
				} catch {
					screenshot = (await page.screenshot({ type: "png" })) as Buffer;
				}

				// Ask the VLM to read the captcha
				const prompt =
					challenge.type === "image-captcha" || challenge.type === "text-captcha"
						? "Read the text or numbers shown in this CAPTCHA image. Reply with ONLY the characters, nothing else."
						: "This is a reCAPTCHA/hCaptcha page. Clicking the checkbox will trigger a visual challenge. Describe what you see in one short sentence.";

				const answer = await reasoner.analyze(screenshot, prompt);
				if (!answer) return null;

				log.info(`${reasoner.name} answered: "${answer.slice(0, 80)}"`);

				// For image/text captchas: type the answer into the input
				if (challenge.type === "image-captcha" || challenge.type === "text-captcha") {
					const input = await page.$('input[name*="captcha"], input[id*="captcha"]');
					if (input) {
						await input.fill(answer.trim());
						// Try to submit
						const submitBtn = await page.$(
							'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Verify")',
						);
						if (submitBtn) await submitBtn.click();
					}
				}

				return {
					token: answer.trim(),
					solver: `Talox VLM (${reasoner.name})`,
					durationMs: Date.now() - start,
				};
			} catch (err) {
				log.error(`VLM captcha solve failed: ${err instanceof Error ? err.message : String(err)}`);
				return null;
			}
		},
	};
}

// ─── Solver Registry ──────────────────────────────────────────────────────────

let registeredSolvers: CaptchaSolver[] = [];

/** Register a solver. Solver is appended — solvers are tried in registration order. */
export function registerSolver(solver: CaptchaSolver): void {
	registeredSolvers.push(solver);
	log.info(`Registered solver: ${solver.name}`);
}

export function clearSolvers(): void {
	registeredSolvers = [];
}

export function getSolvers(): readonly CaptchaSolver[] {
	return registeredSolvers;
}

/**
 * Try all registered solvers in sequence.
 * The built-in VLM solver is always tried LAST (after custom solvers).
 * Returns the first successful solution, or null if all fail.
 */
export async function trySolve(page: Page): Promise<CaptchaSolution | null> {
	// Always include the VLM solver as fallback
	const allSolvers = [...registeredSolvers, createVLMCaptchaSolver()];

	for (const solver of allSolvers) {
		log.info(`Attempting solver: ${solver.name}`);

		const challenge = await solver.detect(page);
		if (!challenge) {
			log.info(`${solver.name} did not detect a solvable captcha`);
			continue;
		}

		log.info(`${solver.name} detected ${challenge.type}`);

		const solution = await solver.solve(page, challenge);
		if (solution) {
			log.info(`${solver.name} solved in ${solution.durationMs}ms`);
			return solution;
		}

		log.warn(`${solver.name} failed to solve, trying next...`);
	}

	return null;
}
