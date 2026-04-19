/**
 * @file ChallengeResolver.ts
 * @description Fallback resolution flows for each challenge type detected
 * by `ChallengeDetector`.
 *
 * `ChallengeDetector` classifies what obstacle is present.
 * `ChallengeResolver` decides what to do about it — attempting local-only
 * strategies first before surfacing a human-handoff request.
 *
 * Resolution strategies per challenge type:
 *
 * | Type             | Strategy                                                  |
 * |------------------|-----------------------------------------------------------|
 * | cloudflare       | wait-and-settle (JS challenge usually self-resolves)      |
 * | captcha          | human handoff (agent cannot solve CAPTCHAs)               |
 * | verification     | wait 2s + retry; escalate to human on failure             |
 * | login-wall       | human handoff (agent has no credentials by default)       |
 * | consent-wall     | auto-click accept button                                  |
 * | age-gate         | auto-click confirm / enter birth year                     |
 * | maintenance      | exponential backoff + retry (up to maxRetries)            |
 * | geo-block        | human handoff (requires VPN / policy-blocked)             |
 * | rate-limited     | exponential backoff + retry                               |
 * | empty-shell-spa  | wait for hydration + retry                                |
 *
 * @example
 * ```ts
 * const detector = new ChallengeDetector();
 * const resolver = new ChallengeResolver();
 *
 * const challengeState = detector.analyze(await talox.getState());
 * if (challengeState.hasChallenge) {
 *   const outcome = await resolver.resolve(challengeState.primaryChallenge!, page);
 *   if (outcome.requiresHuman && outcome.takeoverReason) {
 *     await talox.requestHumanTakeover(outcome.takeoverReason);
 *   }
 * }
 * ```
 */

import type { TakeoverReason } from "../types/events.js";
import type { ChallengeType, DetectedChallenge } from "./ChallengeDetector.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolutionStrategy =
	| "wait-and-settle" // timed wait + reload + re-check
	| "backoff-retry" // exponential backoff between attempts
	| "auto-click-accept" // find and click an accept/confirm button
	| "wait-hydration" // wait for SPA to finish hydrating
	| "human-handoff" // no local resolution — escalate to human
	| "skipped"; // challenge was not applicable

export interface ResolutionAttempt {
	strategy: ResolutionStrategy;
	success: boolean;
	durationMs: number;
	detail?: string;
}

export interface ChallengeOutcome {
	/** Whether the challenge was locally resolved. */
	resolved: boolean;
	/** Whether the agent should request a human takeover. */
	requiresHuman: boolean;
	/** Reason to pass to `requestHumanTakeover()` if `requiresHuman`. */
	takeoverReason?: TakeoverReason;
	/** All resolution attempts made. */
	attempts: ResolutionAttempt[];
	/** Total attempts made. */
	totalAttempts: number;
	/** Final strategy that either succeeded or was last tried. */
	finalStrategy: ResolutionStrategy;
}

export interface ChallengeResolverOptions {
	/**
	 * Maximum number of retry cycles for retriable challenges.
	 * @default 3
	 */
	maxRetries?: number;
	/**
	 * Base delay between retries in milliseconds.
	 * Actual delay is `baseDelayMs * 2^attempt`.
	 * @default 1500
	 */
	baseDelayMs?: number;
	/**
	 * Maximum single retry delay cap in milliseconds.
	 * @default 15000
	 */
	maxDelayMs?: number;
	/**
	 * Maximum time to wait for SPA hydration in milliseconds.
	 * @default 8000
	 */
	spaHydrationTimeoutMs?: number;
}

// ─── Consent/Age-Gate dismiss selectors ─────────────────────────────────────

const ACCEPT_SELECTORS = [
	// Explicit accept/consent buttons
	'button[id*="accept"]',
	'button[id*="consent"]',
	'button[id*="agree"]',
	'button[class*="accept"]',
	'button[class*="consent"]',
	'button[class*="agree"]',
	'[aria-label*="Accept"]',
	'[aria-label*="accept cookies"]',
	'[aria-label*="Agree"]',
	// Age-gate confirm
	'button[id*="confirm"]',
	'button[id*="age"]',
	'button[class*="confirm"]',
	'[data-testid*="accept"]',
	'[data-testid*="confirm"]',
	// Generic "I agree" / "OK" / "Got it"
	'button[aria-label="I agree"]',
	'button[aria-label="Got it"]',
] as const;

// ─── ChallengeResolver ────────────────────────────────────────────────────────

/**
 * Attempts to automatically resolve web challenges detected by
 * `ChallengeDetector`. Dispatches per-type strategies (wait-and-settle,
 * backoff-retry, auto-click-accept, wait-hydration) and escalates to a human
 * handoff when local resolution is not possible (e.g. CAPTCHAs, login walls).
 */
export class ChallengeResolver {
	private readonly maxRetries: number;
	private readonly baseDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly spaHydrationTimeoutMs: number;

	constructor(options: ChallengeResolverOptions = {}) {
		this.maxRetries = options.maxRetries ?? 3;
		this.baseDelayMs = options.baseDelayMs ?? 1500;
		this.maxDelayMs = options.maxDelayMs ?? 15_000;
		this.spaHydrationTimeoutMs = options.spaHydrationTimeoutMs ?? 8_000;
	}

	// ─── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Attempt to resolve a detected challenge using the appropriate strategy.
	 *
	 * @param challenge  The `DetectedChallenge` from `ChallengeDetector.analyze()`.
	 * @param page       Playwright page object (may be null for unit tests).
	 * @returns          A `ChallengeOutcome` describing what was tried and whether it worked.
	 */
	async resolve(challenge: DetectedChallenge, page: any): Promise<ChallengeOutcome> {
		switch (challenge.type) {
			case "cloudflare":
				return this.resolveCloudflare(page);
			case "captcha":
				return this.humanHandoff("captcha-present");
			case "verification":
				return this.resolveVerification(page);
			case "login-wall":
				return this.humanHandoff("login-required");
			case "consent-wall":
				return this.resolveConsentWall(page);
			case "age-gate":
				return this.resolveAgeGate(page);
			case "maintenance":
				return this.resolveWithBackoff(page, "maintenance");
			case "geo-block":
				return this.humanHandoff("policy-blocked");
			case "rate-limited":
				return this.resolveWithBackoff(page, "rate-limited");
			case "empty-shell-spa":
				return this.resolveEmptyShellSpa(page);
			default:
				return this.humanHandoff("challenge-unsolved");
		}
	}

	/**
	 * Suggest a resolution strategy for a challenge type without executing it.
	 * Useful for logging, telemetry, and domain memory.
	 */
	suggestStrategy(type: ChallengeType): ResolutionStrategy {
		const map: Record<ChallengeType, ResolutionStrategy> = {
			cloudflare: "wait-and-settle",
			captcha: "human-handoff",
			verification: "wait-and-settle",
			"login-wall": "human-handoff",
			"consent-wall": "auto-click-accept",
			"age-gate": "auto-click-accept",
			maintenance: "backoff-retry",
			"geo-block": "human-handoff",
			"rate-limited": "backoff-retry",
			"empty-shell-spa": "wait-hydration",
		};
		return map[type] ?? "human-handoff";
	}

	// ─── Strategy Implementations ─────────────────────────────────────────────

	private async resolveCloudflare(page: any): Promise<ChallengeOutcome> {
		const attempts: ResolutionAttempt[] = [];

		for (let i = 0; i < this.maxRetries; i++) {
			const delay = Math.min(this.baseDelayMs * 2 ** i, this.maxDelayMs);
			const t0 = Date.now();

			await this.sleep(delay);

			// Check if the challenge cleared (Cloudflare JS challenges usually self-resolve)
			try {
				const title = await page.title();
				const url = page.url();
				const stillBlocked =
					/just a moment|checking your browser/i.test(title) || /challenge\.cloudflare\.com/i.test(url);

				if (!stillBlocked) {
					attempts.push({
						strategy: "wait-and-settle",
						success: true,
						durationMs: Date.now() - t0,
						detail: `Cleared after ${delay}ms wait`,
					});
					return this.outcome(true, false, attempts, "wait-and-settle");
				}
			} catch { // NOSONAR -- non-fatal
				/* page may still be loading */
			}

			attempts.push({
				strategy: "wait-and-settle",
				success: false,
				durationMs: Date.now() - t0,
				detail: `Still blocked (attempt ${i + 1})`,
			});
		}

		// Cloudflare not cleared — escalate
		return this.outcome(false, true, attempts, "wait-and-settle", "challenge-unsolved");
	}

	private async resolveVerification(page: any): Promise<ChallengeOutcome> {
		const attempts: ResolutionAttempt[] = [];

		// Single wait-and-check — if still present, hand off
		const t0 = Date.now();
		await this.sleep(2000);

		try {
			const title = await page.title();
			if (!/verify|verification|identity check/i.test(title)) {
				attempts.push({ strategy: "wait-and-settle", success: true, durationMs: Date.now() - t0 });
				return this.outcome(true, false, attempts, "wait-and-settle");
			}
		} catch { // NOSONAR -- non-fatal
			/* page may still be loading */
		}

		attempts.push({ strategy: "wait-and-settle", success: false, durationMs: Date.now() - t0 });
		return this.outcome(false, true, attempts, "human-handoff", "challenge-unsolved");
	}

	private async resolveConsentWall(page: any): Promise<ChallengeOutcome> {
		const attempts: ResolutionAttempt[] = [];
		const t0 = Date.now();

		for (const sel of ACCEPT_SELECTORS) {
			try {
				const btn = await page.$(sel);
				if (!btn) continue;
				const visible = await btn.isVisible();
				if (!visible) continue;

				await btn.click();
				await this.sleep(400);

				attempts.push({
					strategy: "auto-click-accept",
					success: true,
					durationMs: Date.now() - t0,
					detail: `Clicked: ${sel}`,
				});
				return this.outcome(true, false, attempts, "auto-click-accept");
			} catch { // NOSONAR -- non-fatal
				/* try next */
			}
		}

		attempts.push({
			strategy: "auto-click-accept",
			success: false,
			durationMs: Date.now() - t0,
			detail: "No accept button found",
		});
		return this.outcome(false, false, attempts, "auto-click-accept");
	}

	private async resolveAgeGate(page: any): Promise<ChallengeOutcome> {
		// Age gates usually have an "I am 18+" or "Enter" button
		return this.resolveConsentWall(page);
	}

	private async resolveWithBackoff(page: any, type: "maintenance" | "rate-limited"): Promise<ChallengeOutcome> {
		const attempts: ResolutionAttempt[] = [];

		for (let i = 0; i < this.maxRetries; i++) {
			const delay = Math.min(this.baseDelayMs * 2 ** i, this.maxDelayMs);
			const t0 = Date.now();

			await this.sleep(delay);

			try {
				await page.reload({ waitUntil: "domcontentloaded" });
				const title = await page.title();

				const stillDown = type === "maintenance" ? /maintenance|be right back|service unavailable/i.test(title) : false; // for rate-limit we just wait; actual check is on next action

				if (!stillDown) {
					attempts.push({
						strategy: "backoff-retry",
						success: true,
						durationMs: Date.now() - t0,
						detail: `Resolved after reload (attempt ${i + 1})`,
					});
					return this.outcome(true, false, attempts, "backoff-retry");
				}
			} catch { // NOSONAR -- non-fatal
				/* reload failed */
			}

			attempts.push({
				strategy: "backoff-retry",
				success: false,
				durationMs: Date.now() - t0,
				detail: `Still blocked (attempt ${i + 1})`,
			});
		}

		return this.outcome(false, false, attempts, "backoff-retry");
	}

	private async resolveEmptyShellSpa(page: any): Promise<ChallengeOutcome> {
		const attempts: ResolutionAttempt[] = [];
		const maxWaitMs = this.spaHydrationTimeoutMs;
		const pollMs = 500;
		const t0 = Date.now();

		while (Date.now() - t0 < maxWaitMs) {
			await this.sleep(pollMs);
			try {
				// Check if interactive elements appeared
				const count = await page.evaluate(() => document.querySelectorAll('button, a, input, [role="button"]').length);
				if (count > 2) {
					attempts.push({
						strategy: "wait-hydration",
						success: true,
						durationMs: Date.now() - t0,
						detail: `${count} interactive elements found`,
					});
					return this.outcome(true, false, attempts, "wait-hydration");
				}
			} catch { // NOSONAR -- non-fatal
				/* page still loading */
			}
		}

		attempts.push({
			strategy: "wait-hydration",
			success: false,
			durationMs: Date.now() - t0,
			detail: `No interactive elements after ${maxWaitMs}ms`,
		});
		return this.outcome(false, false, attempts, "wait-hydration");
	}

	private humanHandoff(reason: TakeoverReason): ChallengeOutcome {
		return this.outcome(
			false,
			true,
			[{ strategy: "human-handoff", success: false, durationMs: 0, detail: `Requires human: ${reason}` }],
			"human-handoff",
			reason,
		);
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private outcome(
		resolved: boolean,
		requiresHuman: boolean,
		attempts: ResolutionAttempt[],
		finalStrategy: ResolutionStrategy,
		takeoverReason?: TakeoverReason,
	): ChallengeOutcome {
		const base: ChallengeOutcome = { resolved, requiresHuman, attempts, totalAttempts: attempts.length, finalStrategy };
		if (takeoverReason !== undefined) base.takeoverReason = takeoverReason;
		return base;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((r) => setTimeout(r, ms));
	}
}
