/**
 * @file CaptchaSolver.ts
 * @description Pluggable external CAPTCHA solver interface.
 *
 * Talox detects captchas via `ChallengeDetector` but cannot solve them locally.
 * This module provides a plugin interface for external solving services
 * (2captcha, Anti-Captcha, CapSolver) and a registration API for custom solvers.
 *
 * ## Built-in providers
 *
 * | Provider     | API                          | Pricing              |
 * |-------------|------------------------------|----------------------|
 * | 2captcha    | 2captcha.com                 | ~$3 per 1000 solves  |
 * | Anti-Captcha| anti-captcha.com             | same API as 2captcha |
 * | CapSolver   | capsolver.com                | ~$2 per 1000, AI     |
 *
 * ## Custom solver
 *
 * ```ts
 * talox.useSolver({
 *   name: "my-service",
 *   detect: async (page) => ({ type: "hcaptcha", sitekey: "..." }),
 *   solve: async (page, challenge) => "captcha-token",
 * });
 * ```
 */

import type { Page } from "playwright-core";
import { createLogger } from "./Logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Known CAPTCHA variants that solvers can handle. */
export type CaptchaVariant =
	| "recaptcha-v2"
	| "recaptcha-v3"
	| "hcaptcha"
	| "funcaptcha" // Arkose Labs
	| "turnstile" // Cloudflare Turnstile
	| "image-captcha"
	| "text-captcha";

/** Structured info a solver needs to process the challenge. */
export interface CaptchaChallenge {
	type: CaptchaVariant;
	sitekey: string;
	pageUrl: string;
	/** Optional: data-s attibute for reCAPTCHA invisibility. */
	dataS?: string;
	/** Optional: true if this is an invisible reCAPTCHA. */
	invisible?: boolean;
}

/** Result from a successful solve. */
export interface CaptchaSolution {
	/** The token / g-recaptcha-response to inject. */
	token: string;
	/** Which solver produced this. */
	solver: string;
	/** How long it took in ms. */
	durationMs: number;
}

/**
 * A pluggable CAPTCHA solver.
 *
 * `detect` — called to identify the challenge on the page.
 * `solve`  — called to submit the challenge to the solving service.
 *
 * Return `null` from `detect` if this solver doesn't handle this challenge type.
 * Return `null` from `solve` if the service failed (Talox falls back to next solver).
 */
export interface CaptchaSolver {
	readonly name: string;

	/**
	 * Inspect the page to identify a captcha challenge.
	 * Return null if no captcha is recognized by this solver.
	 */
	detect(page: Page): Promise<CaptchaChallenge | null>;

	/**
	 * Submit the challenge to the solving service.
	 * Return null if the service failed or timed out.
	 */
	solve(page: Page, challenge: CaptchaChallenge): Promise<CaptchaSolution | null>;
}

// ─── Solver Registry ──────────────────────────────────────────────────────────

const log = createLogger("Solver");

/** Ordered list of registered solvers — tried in sequence until one succeeds. */
let registeredSolvers: CaptchaSolver[] = [];

/** Register a solver. Solver is appended — solvers are tried in registration order. */
export function registerSolver(solver: CaptchaSolver): void {
	registeredSolvers.push(solver);
	log.info(`Registered solver: ${solver.name}`);
}

/** Remove all registered solvers. */
export function clearSolvers(): void {
	registeredSolvers = [];
}

/** Get a read-only view of registered solvers. */
export function getSolvers(): readonly CaptchaSolver[] {
	return registeredSolvers;
}

/**
 * Try all registered solvers in sequence.
 * Returns the first successful solution, or null if all fail.
 */
export async function trySolve(page: Page): Promise<CaptchaSolution | null> {
	for (const solver of registeredSolvers) {
		log.info(`Attempting solver: ${solver.name}`);

		const challenge = await solver.detect(page);
		if (!challenge) {
			log.info(`${solver.name} did not detect a solvable captcha`);
			continue;
		}

		log.info(`${solver.name} detected ${challenge.type} (sitekey: ${challenge.sitekey})`);

		const solution = await solver.solve(page, challenge);
		if (solution) {
			log.info(`${solver.name} solved in ${solution.durationMs}ms`);
			return solution;
		}

		log.warn(`${solver.name} failed to solve, trying next...`);
	}

	return null;
}

// ─── Built-in Provider: 2captcha / Anti-Captcha ──────────────────────────────

/**
 * Shared config for 2captcha and Anti-Captcha (identical API).
 */
export interface TwoCaptchaConfig {
	apiKey: string;
	/** API endpoint — defaults to 2captcha. Use anti-captcha.com for Anti-Captcha. */
	apiUrl?: string;
	/** Max wait time for solve in ms. Default: 120000 (2 min). */
	timeoutMs?: number;
	/** Polling interval in ms. Default: 3000. */
	pollIntervalMs?: number;
}

/**
 * Creates a solver backed by 2captcha or Anti-Captcha.
 *
 * These services use the same API:
 * 1. POST `in.php` with method=userrecaptcha + googlekey + pageurl
 * 2. Poll `res.php` until the token is ready
 * 3. Return the token
 */
export function createTwoCaptchaSolver(config: TwoCaptchaConfig): CaptchaSolver {
	const baseUrl = config.apiUrl ?? "https://api.2captcha.com";
	const timeout = config.timeoutMs ?? 120_000;
	const pollMs = config.pollIntervalMs ?? 3_000;

	async function apiCall(params: Record<string, string>): Promise<string> {
		const url = new URL(`${baseUrl}/in.php`);
		url.searchParams.set("key", config.apiKey);
		for (const [k, v] of Object.entries(params)) {
			url.searchParams.set(k, v);
		}

		const res = await fetch(url.toString());
		const text = await res.text();

		if (!text.startsWith("OK|")) {
			throw new Error(`2captcha API error: ${text}`);
		}

		return text.slice(3); // Strip "OK|"
	}

	return {
		name: "2captcha",

		async detect(page) {
			const url = page.url();

			// reCAPTCHA v2
			const recaptchaEl = await page.$('[data-sitekey][class*="g-recaptcha"], [data-sitekey]:not([data-sitekey=""])');
			if (recaptchaEl) {
				const sitekey = await recaptchaEl.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "recaptcha-v2", sitekey, pageUrl: url };
				}
			}

			// hCaptcha
			const hcaptchaEl = await page.$(".h-captcha[data-sitekey]");
			if (hcaptchaEl) {
				const sitekey = await hcaptchaEl.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "hcaptcha", sitekey, pageUrl: url };
				}
			}

			// Invisible reCAPTCHA — look for the callback script
			const hasRecaptchaScript = await page.$('script[src*="recaptcha/api.js"]');
			if (hasRecaptchaScript) {
				// Try to extract sitekey from the script's data-sitekey attribute on the page
				const sitekeyEl = await page.$("[data-sitekey]");
				if (sitekeyEl) {
					const sitekey = await sitekeyEl.getAttribute("data-sitekey");
					if (sitekey) {
						return { type: "recaptcha-v2", sitekey, pageUrl: url, invisible: true };
					}
				}
			}

			return null;
		},

		async solve(_page, challenge) {
			const startTime = Date.now();

			try {
				// Submit the captcha
				const captchaId = await apiCall({
					method: "userrecaptcha",
					googlekey: challenge.sitekey,
					pageurl: challenge.pageUrl,
					...(challenge.invisible ? { invisible: "1" } : {}),
				});

				// Poll for result
				const deadline = Date.now() + timeout;
				while (Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, pollMs));

					const resUrl = new URL(`${baseUrl}/res.php`);
					resUrl.searchParams.set("key", config.apiKey);
					resUrl.searchParams.set("action", "get");
					resUrl.searchParams.set("id", captchaId);

					const res = await fetch(resUrl.toString());
					const resText = await res.text();

					if (resText.startsWith("OK|")) {
						return {
							token: resText.slice(3),
							solver: "2captcha",
							durationMs: Date.now() - startTime,
						};
					}

					if (resText === "ERROR_CAPTCHA_UNSOLVABLE") {
						return null; // Give up, let another solver try
					}

					// Still processing — CAPCHA_NOT_READY, keep polling
				}

				log.warn("2captcha timed out");
				return null;
			} catch (err) {
				log.error(`2captcha error: ${err instanceof Error ? err.message : String(err)}`);
				return null;
			}
		},
	};
}

// ─── Built-in Provider: CapSolver ─────────────────────────────────────────────

/**
 * Config for CapSolver (capsolver.com).
 */
export interface CapSolverConfig {
	apiKey: string;
	/** Max wait time for solve in ms. Default: 120000. */
	timeoutMs?: number;
	/** Polling interval in ms. Default: 3000. */
	pollIntervalMs?: number;
}

/**
 * Creates a solver backed by CapSolver.
 *
 * CapSolver uses a REST API:
 * 1. POST `createTask` with task type + sitekey + pageurl
 * 2. Poll `getTaskResult` until token is ready
 * 3. Return the token
 */
export function createCapSolverSolver(config: CapSolverConfig): CaptchaSolver {
	const baseUrl = "https://api.capsolver.com";
	const timeout = config.timeoutMs ?? 120_000;
	const pollMs = config.pollIntervalMs ?? 3_000;

	async function apiCall(body: Record<string, unknown>): Promise<Record<string, unknown>> {
		const res = await fetch(`${baseUrl}/createTask`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				clientKey: config.apiKey,
				...body,
			}),
		});

		const data = (await res.json()) as Record<string, unknown>;
		if ((data.errorId as number) !== 0) {
			throw new Error(`CapSolver error: ${data.errorDescription ?? "unknown"}`);
		}

		return data;
	}

	return {
		name: "CapSolver",

		async detect(page) {
			const url = page.url();

			// reCAPTCHA v2 / v3
			const recaptchaEl = await page.$("[data-sitekey]");
			if (recaptchaEl) {
				const sitekey = await recaptchaEl.getAttribute("data-sitekey");
				if (sitekey) {
					// Check if v3 or v2
					const isV3 = await page.$('script[src*="recaptcha/api.js?render="]');
					return {
						type: isV3 ? "recaptcha-v3" : "recaptcha-v2",
						sitekey,
						pageUrl: url,
					};
				}
			}

			// hCaptcha
			const hcaptchaEl = await page.$(".h-captcha[data-sitekey]");
			if (hcaptchaEl) {
				const sitekey = await hcaptchaEl.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "hcaptcha", sitekey, pageUrl: url };
				}
			}

			// Cloudflare Turnstile
			const turnstileEl = await page.$(".cf-turnstile[data-sitekey]");
			if (turnstileEl) {
				const sitekey = await turnstileEl.getAttribute("data-sitekey");
				if (sitekey) {
					return { type: "turnstile", sitekey, pageUrl: url };
				}
			}

			return null;
		},

		async solve(_page, challenge) {
			const startTime = Date.now();

			try {
				const taskType: Record<string, string> = {
					"recaptcha-v2": "ReCaptchaV2TaskProxyless",
					"recaptcha-v3": "ReCaptchaV3TaskProxyless",
					"hcaptcha": "HCaptchaTaskProxyless",
					"turnstile": "AntiTurnstileTaskProxyLess",
					"funcaptcha": "FunCaptchaTaskProxyless",
				};

				const type = taskType[challenge.type];
				if (!type) {
					log.warn(`CapSolver doesn't support ${challenge.type}`);
					return null;
				}

				const taskData = await apiCall({
					task: {
						type,
						websiteURL: challenge.pageUrl,
						websiteKey: challenge.sitekey,
					},
				});

				const taskId = taskData.taskId as string;
				if (!taskId) return null;

				// Poll for result
				const deadline = Date.now() + timeout;
				while (Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, pollMs));

					const resultData = await apiCall({
						taskId,
					});

					if ((resultData.status as string) === "ready") {
						const solution = resultData.solution as Record<string, string>;
						return {
							token: solution.gRecaptchaResponse ?? solution.token ?? "",
							solver: "CapSolver",
							durationMs: Date.now() - startTime,
						};
					}

					if ((resultData.status as string) === "failed") {
						return null;
					}

					// Status is "processing" — keep polling
				}

				log.warn("CapSolver timed out");
				return null;
			} catch (err) {
				log.error(`CapSolver error: ${err instanceof Error ? err.message : String(err)}`);
				return null;
			}
		},
	};
}
