/**
 * @file ChallengeDetector.ts
 * @description Dedicated challenge detection engine for Talox.
 *
 * Classifies what *type of obstacle* is on the current page — distinct from
 * `BotDetector`, which only asks "is the site blocking me because I look like a bot?"
 *
 * `ChallengeDetector` asks: "what specific obstacle is here, and what should the
 * agent do about it?" The output is a `ChallengeState` that the agent can inspect
 * to decide whether to wait, escalate, or request a human takeover.
 *
 * Detection priority (highest → lowest):
 * 1. Cloudflare JS challenge
 * 2. CAPTCHA variants (hCaptcha, reCAPTCHA, Arkose, etc.)
 * 3. Generic verification interstitial
 * 4. Login wall
 * 5. Cookie / GDPR consent wall
 * 6. Age gate
 * 7. Maintenance / error page
 * 8. Geo-block
 * 9. Rate limit
 * 10. Empty-shell SPA (not yet hydrated)
 */

import type { TaloxPageState } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChallengeType =
	| "cloudflare" // Cloudflare JS challenge / "Just a moment" interstitial
	| "captcha" // CAPTCHA (hCaptcha, reCAPTCHA, Arkose, Turnstile, etc.)
	| "verification" // Generic "verify you are human" interstitial
	| "login-wall" // Content requires authentication
	| "consent-wall" // Cookie / GDPR consent gate
	| "age-gate" // Age verification required
	| "maintenance" // Site under maintenance or returning 5xx
	| "geo-block" // Geographic restriction
	| "rate-limited" // HTTP 429 / too many requests
	| "empty-shell-spa"; // SPA mounted but not yet hydrated (very few interactive nodes)

export interface DetectedChallenge {
	/** What kind of obstacle this is. */
	type: ChallengeType;
	/** Detection confidence 0–1.0. */
	confidence: number;
	/** Human-readable evidence that triggered this detection. */
	evidence: string[];
	/** True if waiting / retrying might resolve this without human help. */
	canRetry: boolean;
	/** True if human takeover is the expected resolution path. */
	requiresHuman: boolean;
	/** Suggested `TakeoverReason` to pass to `requestHumanTakeover()` if applicable. */
	suggestedTakeoverReason?: "captcha-present" | "login-required" | "challenge-unsolved" | "policy-blocked";
}

export interface ChallengeState {
	/** True if at least one challenge was detected. */
	hasChallenge: boolean;
	/** All detected challenges, sorted by confidence descending. */
	challenges: DetectedChallenge[];
	/** Highest-confidence challenge, or null if none detected. */
	primaryChallenge: DetectedChallenge | null;
	/** ISO timestamp of this scan. */
	timestamp: string;
	/** The URL that was scanned. */
	url: string;
}

// ─── Detection Patterns ───────────────────────────────────────────────────────

const CLOUDFLARE_TITLE = [/just a moment/i, /checking your browser/i, /ddos.protection/i, /cloudflare/i];
const CLOUDFLARE_URL = [/challenge\.cloudflare\.com/i, /cf_chl_opt/i];
const CLOUDFLARE_BODY = [/cf-browser-verification/i, /challenge-platform/i, /cf_chl_opt/i, /cloudflare ray id/i];

const CAPTCHA_TITLE = [/captcha/i, /verify you are human/i, /are you a robot/i, /security check/i, /bot check/i];
const CAPTCHA_URL = [/\/captcha/i, /hcaptcha\.com/i, /recaptcha/i, /\/challenge\//i, /arkoselabs\.com/i];
const CAPTCHA_BODY = [/hcaptcha/i, /recaptcha/i, /i'm not a robot/i, /arkose/i, /turnstile/i, /solve.*puzzle/i];

const VERIFICATION_TITLE = [/verify/i, /please verify/i, /human verification/i, /identity check/i];
const VERIFICATION_BODY = [/verify.*identity/i, /confirm.*human/i, /click.*verify/i];

const LOGIN_WALL_URL = [/\/login/i, /\/signin/i, /\/auth/i, /\/account\/login/i];
const LOGIN_WALL_BODY = [
	/sign in to continue/i,
	/log in to continue/i,
	/create an account/i,
	/please log in/i,
	/login required/i,
	/sign in required/i,
];
const LOGIN_WALL_TITLE = [/sign in/i, /log in/i, /login/i];

const CONSENT_BODY = [
	/accept.*cookie/i,
	/cookie.*consent/i,
	/we use cookies/i,
	/privacy.*consent/i,
	/gdpr/i,
	/accept.*privacy/i,
];
const CONSENT_TITLE = [/cookie/i, /privacy/i, /consent/i];

const AGE_BODY = [/confirm.*age/i, /are you.*18/i, /are you.*21/i, /age.*verification/i, /must be.*years/i];
const AGE_TITLE = [/age.*verification/i, /age.*confirm/i];

const MAINTENANCE_TITLE = [/maintenance/i, /be right back/i, /down for maintenance/i, /503/i, /service unavailable/i];
const MAINTENANCE_STATUS = new Set([503, 502, 500, 521, 522, 523, 524]);

const GEO_BODY = [
	/not available in your (country|region)/i,
	/geo.*restrict/i,
	/your location/i,
	/service.*not available.*region/i,
];
const GEO_TITLE = [/not available/i, /restricted/i];
const GEO_URL = [/\/geo/i, /blocked/i, /\/denied/i];

// ─── ChallengeDetector ────────────────────────────────────────────────────────

/**
 * Stateless challenge classifier. Call `analyze(state)` after any navigation
 * to get a rich `ChallengeState` the agent can act on.
 *
 * @example
 * ```ts
 * const detector = new ChallengeDetector();
 * const challengeState = detector.analyze(await talox.getState());
 *
 * if (challengeState.hasChallenge) {
 *   const { type, requiresHuman, suggestedTakeoverReason } = challengeState.primaryChallenge!;
 *   if (requiresHuman && suggestedTakeoverReason) {
 *     await talox.requestHumanTakeover(suggestedTakeoverReason);
 *   }
 * }
 * ```
 */
export class ChallengeDetector {
	/**
	 * Analyze a `TaloxPageState` and classify any challenges present.
	 * Returns a `ChallengeState` with all detected challenges sorted by confidence.
	 */
	analyze(state: TaloxPageState): ChallengeState {
		const candidates: DetectedChallenge[] = [];
		const pageText = this.extractPageText(state);

		const cf = this.detectCloudflare(state, pageText);
		if (cf) candidates.push(cf);

		const captcha = this.detectCaptcha(state, pageText);
		if (captcha) candidates.push(captcha);

		const verification = this.detectVerification(state, pageText);
		if (verification) candidates.push(verification);

		const loginWall = this.detectLoginWall(state, pageText);
		if (loginWall) candidates.push(loginWall);

		const consent = this.detectConsentWall(state, pageText);
		if (consent) candidates.push(consent);

		const ageGate = this.detectAgeGate(state, pageText);
		if (ageGate) candidates.push(ageGate);

		const maintenance = this.detectMaintenance(state, pageText);
		if (maintenance) candidates.push(maintenance);

		const geoBlock = this.detectGeoBlock(state, pageText);
		if (geoBlock) candidates.push(geoBlock);

		const rateLimited = this.detectRateLimit(state);
		if (rateLimited) candidates.push(rateLimited);

		// Empty-shell SPA is a fallback — only fire when no higher-priority challenge was found
		if (candidates.length === 0) {
			const emptySpa = this.detectEmptyShellSpa(state);
			if (emptySpa) candidates.push(emptySpa);
		}

		candidates.sort((a, b) => b.confidence - a.confidence);
		const sorted = candidates;

		return {
			hasChallenge: sorted.length > 0,
			challenges: sorted,
			primaryChallenge: sorted[0] ?? null,
			timestamp: new Date().toISOString(),
			url: state.url,
		};
	}

	// ─── Individual Detectors ─────────────────────────────────────────────────

	private detectCloudflare(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (CLOUDFLARE_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches Cloudflare pattern: "${state.title}"`);
			score += 0.5;
		}
		if (CLOUDFLARE_URL.some((p) => p.test(state.url))) {
			evidence.push(`URL matches Cloudflare challenge: "${state.url}"`);
			score += 0.4;
		}
		if (CLOUDFLARE_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains Cloudflare challenge markers");
			score += 0.3;
		}

		if (score === 0) return null;

		return {
			type: "cloudflare",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: true,
			requiresHuman: false,
			suggestedTakeoverReason: "challenge-unsolved",
		};
	}

	private detectCaptcha(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (CAPTCHA_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches CAPTCHA pattern: "${state.title}"`);
			score += 0.5;
		}
		if (CAPTCHA_URL.some((p) => p.test(state.url))) {
			evidence.push(`URL matches CAPTCHA service: "${state.url}"`);
			score += 0.45;
		}
		if (CAPTCHA_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains CAPTCHA element markers");
			score += 0.4;
		}
		// Fingerprinting scripts in network as additional signal
		const networkUrls = state.network.failedRequests.map((r) => r.url).join(" ");
		if (/hcaptcha|recaptcha|arkoselabs|funcaptcha/.test(networkUrls)) {
			evidence.push("CAPTCHA service loaded in network requests");
			score += 0.3;
		}

		if (score === 0) return null;

		return {
			type: "captcha",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: false,
			requiresHuman: true,
			suggestedTakeoverReason: "captcha-present",
		};
	}

	private detectVerification(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (VERIFICATION_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches verification pattern: "${state.title}"`);
			score += 0.4;
		}
		if (VERIFICATION_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains verification prompt");
			score += 0.35;
		}

		if (score === 0) return null;

		// Don't double-count with cloudflare / captcha (lower priority)
		return {
			type: "verification",
			confidence: Math.min(score, 0.85),
			evidence,
			canRetry: false,
			requiresHuman: true,
			suggestedTakeoverReason: "challenge-unsolved",
		};
	}

	private detectLoginWall(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (LOGIN_WALL_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches login pattern: "${state.title}"`);
			score += 0.3;
		}
		if (LOGIN_WALL_URL.some((p) => p.test(state.url))) {
			evidence.push(`URL matches login endpoint: "${state.url}"`);
			score += 0.35;
		}
		if (LOGIN_WALL_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains login prompt");
			score += 0.35;
		}

		if (score === 0) return null;

		return {
			type: "login-wall",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: false,
			requiresHuman: true,
			suggestedTakeoverReason: "login-required",
		};
	}

	private detectConsentWall(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (CONSENT_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches consent pattern: "${state.title}"`);
			score += 0.25;
		}
		if (CONSENT_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains cookie/privacy consent gate");
			score += 0.45;
		}
		// Consent walls often block interactive content — check low node count alongside text
		if (state.nodes.length < 5 && CONSENT_BODY.some((p) => p.test(pageText))) {
			evidence.push("Very few AX nodes with consent text — likely modal blocking content");
			score += 0.2;
		}

		if (score === 0) return null;

		return {
			type: "consent-wall",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: false,
			requiresHuman: false, // Agent can usually click "Accept"
		};
	}

	private detectAgeGate(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (AGE_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches age gate pattern: "${state.title}"`);
			score += 0.4;
		}
		if (AGE_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains age verification prompt");
			score += 0.5;
		}

		if (score === 0) return null;

		return {
			type: "age-gate",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: false,
			requiresHuman: false, // Agent can usually click through if not DOB-based
		};
	}

	private detectMaintenance(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (MAINTENANCE_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches maintenance pattern: "${state.title}"`);
			score += 0.5;
		}
		if (MAINTENANCE_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains maintenance message");
			score += 0.4;
		}
		const has5xx = state.network.failedRequests.some((r) => MAINTENANCE_STATUS.has(r.status));
		if (has5xx) {
			evidence.push("Network requests returning 5xx / Cloudflare origin error status");
			score += 0.35;
		}

		if (score === 0) return null;

		return {
			type: "maintenance",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: true,
			requiresHuman: false,
		};
	}

	private detectGeoBlock(state: TaloxPageState, pageText: string): DetectedChallenge | null {
		const evidence: string[] = [];
		let score = 0;

		if (GEO_TITLE.some((p) => p.test(state.title))) {
			evidence.push(`Title matches geo-block pattern: "${state.title}"`);
			score += 0.3;
		}
		if (GEO_URL.some((p) => p.test(state.url))) {
			evidence.push(`URL matches geo-block pattern: "${state.url}"`);
			score += 0.3;
		}
		if (GEO_BODY.some((p) => p.test(pageText))) {
			evidence.push("Page body contains geographic restriction message");
			score += 0.5;
		}

		if (score === 0) return null;

		return {
			type: "geo-block",
			confidence: Math.min(score, 1),
			evidence,
			canRetry: false,
			requiresHuman: false,
			suggestedTakeoverReason: "policy-blocked",
		};
	}

	private detectRateLimit(state: TaloxPageState): DetectedChallenge | null {
		const has429 = state.network.failedRequests.some((r) => r.status === 429);
		if (!has429) return null;

		return {
			type: "rate-limited",
			confidence: 0.95,
			evidence: ["HTTP 429 Too Many Requests detected in network failures"],
			canRetry: true,
			requiresHuman: false,
		};
	}

	private detectEmptyShellSpa(state: TaloxPageState): DetectedChallenge | null {
		// A suspicious SPA shell: very few interactive nodes, no console errors, no network failures
		// (real content would either have errors or interactivity)
		const nodeCount = state.nodes.length;
		const interactiveCount = state.interactiveElements.length;
		const hasErrors = state.console.errors.length > 0 || state.network.failedRequests.length > 0;

		if (nodeCount > 3 || interactiveCount > 1 || hasErrors) return null;
		if (!state.url.startsWith("http")) return null;

		return {
			type: "empty-shell-spa",
			confidence: 0.5,
			evidence: [
				`Only ${nodeCount} AX nodes and ${interactiveCount} interactive elements`,
				"No console errors or network failures — likely still hydrating",
			],
			canRetry: true,
			requiresHuman: false,
		};
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private extractPageText(state: TaloxPageState): string {
		return [
			state.title,
			...state.nodes.map((n) => n.name ?? ""),
			...state.nodes.map((n) => n.description ?? ""),
			...(state.console.logs ?? []),
		].join(" ");
	}
}

// Missing pattern used in maintenance detection
const MAINTENANCE_BODY = [/be right back/i, /scheduled maintenance/i, /temporarily unavailable/i, /under maintenance/i];
