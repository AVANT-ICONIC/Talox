import { describe, expect, it } from "vitest";
import { ChallengeDetector } from "../../src/core/ChallengeDetector";
import type { TaloxPageState } from "../../src/types/index";

function makeState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

const detector = new ChallengeDetector();

describe("ChallengeDetector", () => {
	describe("clean page", () => {
		it("returns hasChallenge=false on a normal page", () => {
			const state = makeState({
				title: "Home | My App",
				nodes: [
					{ id: "n1", role: "button", name: "Sign up", boundingBox: { x: 0, y: 0, width: 100, height: 40 } },
					{ id: "n2", role: "link", name: "About", boundingBox: { x: 0, y: 50, width: 60, height: 20 } },
					{ id: "n3", role: "heading", name: "Welcome", boundingBox: { x: 0, y: 100, width: 300, height: 50 } },
					{ id: "n4", role: "textbox", name: "Search", boundingBox: { x: 0, y: 200, width: 200, height: 36 } },
				],
				interactiveElements: [{ id: "e1", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
			});
			const result = detector.analyze(state);
			expect(result.hasChallenge).toBe(false);
			expect(result.challenges).toHaveLength(0);
			expect(result.primaryChallenge).toBeNull();
		});

		it("returns url and timestamp", () => {
			const state = makeState({ url: "https://example.com/page" });
			const result = detector.analyze(state);
			expect(result.url).toBe("https://example.com/page");
			expect(typeof result.timestamp).toBe("string");
		});
	});

	describe("Cloudflare detection", () => {
		it('detects title "Just a moment"', () => {
			const state = makeState({ title: "Just a moment..." });
			const result = detector.analyze(state);
			expect(result.hasChallenge).toBe(true);
			expect(result.primaryChallenge?.type).toBe("cloudflare");
		});

		it('detects "Checking your browser"', () => {
			const state = makeState({ title: "Checking your browser before accessing the site" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("cloudflare");
		});

		it("detects challenge.cloudflare.com URL", () => {
			const state = makeState({ url: "https://challenge.cloudflare.com/cdn-cgi/challenge-platform/h/b/flow" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("cloudflare");
		});

		it("sets canRetry=true and requiresHuman=false", () => {
			const state = makeState({ title: "Just a moment..." });
			const c = detector.analyze(state).primaryChallenge!;
			expect(c.canRetry).toBe(true);
			expect(c.requiresHuman).toBe(false);
		});
	});

	describe("CAPTCHA detection", () => {
		it('detects "captcha" in title', () => {
			const state = makeState({ title: "Complete CAPTCHA to continue" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("captcha");
		});

		it("detects hCaptcha URL", () => {
			const state = makeState({ url: "https://example.com/captcha/hcaptcha" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("captcha");
		});

		it("detects CAPTCHA service in network requests", () => {
			const state = makeState({
				network: { failedRequests: [{ url: "https://hcaptcha.com/challenge", status: 200 }] },
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("captcha");
		});

		it("sets requiresHuman=true and canRetry=false", () => {
			const state = makeState({ title: "CAPTCHA required" });
			const c = detector.analyze(state).primaryChallenge!;
			expect(c.requiresHuman).toBe(true);
			expect(c.canRetry).toBe(false);
			expect(c.suggestedTakeoverReason).toBe("captcha-present");
		});
	});

	describe("Login wall detection", () => {
		it("detects login URL pattern", () => {
			const state = makeState({ url: "https://example.com/login" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("login-wall");
		});

		it('detects "Sign in to continue" in page content', () => {
			const state = makeState({
				nodes: [
					{
						id: "n1",
						role: "heading",
						name: "Sign in to continue",
						boundingBox: { x: 0, y: 0, width: 300, height: 40 },
					},
				],
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("login-wall");
		});

		it("sets suggestedTakeoverReason=login-required", () => {
			const state = makeState({ url: "https://example.com/signin" });
			const c = detector.analyze(state).primaryChallenge!;
			expect(c.suggestedTakeoverReason).toBe("login-required");
		});
	});

	describe("Consent wall detection", () => {
		it('detects "We use cookies" in body text', () => {
			const state = makeState({
				nodes: [
					{
						id: "n1",
						role: "text",
						name: "We use cookies to improve your experience.",
						boundingBox: { x: 0, y: 0, width: 400, height: 30 },
					},
				],
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("consent-wall");
		});

		it("detects GDPR consent text", () => {
			const state = makeState({
				nodes: [
					{
						id: "n1",
						role: "text",
						name: "Accept privacy policy to continue",
						boundingBox: { x: 0, y: 0, width: 400, height: 30 },
					},
				],
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("consent-wall");
		});

		it("sets requiresHuman=false (agent can click accept)", () => {
			const state = makeState({
				nodes: [
					{
						id: "n1",
						role: "text",
						name: "cookie consent required",
						boundingBox: { x: 0, y: 0, width: 400, height: 30 },
					},
				],
			});
			const c = detector.analyze(state).primaryChallenge!;
			expect(c.requiresHuman).toBe(false);
		});
	});

	describe("Rate limit detection", () => {
		it("detects HTTP 429 in failed requests", () => {
			const state = makeState({
				network: { failedRequests: [{ url: "https://api.example.com/data", status: 429 }] },
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("rate-limited");
			expect(result.primaryChallenge?.confidence).toBeGreaterThan(0.9);
		});

		it("sets canRetry=true", () => {
			const state = makeState({
				network: { failedRequests: [{ url: "https://api.example.com", status: 429 }] },
			});
			expect(detector.analyze(state).primaryChallenge?.canRetry).toBe(true);
		});
	});

	describe("Maintenance detection", () => {
		it('detects "Be right back" title', () => {
			const state = makeState({ title: "Be right back" });
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("maintenance");
		});

		it("detects 503 in failed requests", () => {
			const state = makeState({
				network: { failedRequests: [{ url: "https://example.com/api", status: 503 }] },
			});
			const result = detector.analyze(state);
			expect(result.primaryChallenge?.type).toBe("maintenance");
		});

		it("sets canRetry=true", () => {
			const state = makeState({ title: "Service unavailable" });
			expect(detector.analyze(state).primaryChallenge?.canRetry).toBe(true);
		});
	});

	describe("Empty shell SPA detection", () => {
		it("flags page with zero nodes and no errors as possible empty SPA", () => {
			const state = makeState({
				title: "My App",
				url: "https://example.com/dashboard",
				nodes: [],
				interactiveElements: [],
			});
			const result = detector.analyze(state);
			const spa = result.challenges.find((c) => c.type === "empty-shell-spa");
			expect(spa).toBeDefined();
		});

		it("does NOT flag page with enough nodes", () => {
			const state = makeState({
				nodes: Array.from({ length: 5 }, (_, i) => ({
					id: `n${i}`,
					role: "button",
					name: `Button ${i}`,
					boundingBox: { x: 0, y: i * 50, width: 100, height: 40 },
				})),
			});
			const spa = detector.analyze(state).challenges.find((c) => c.type === "empty-shell-spa");
			expect(spa).toBeUndefined();
		});
	});

	describe("evidence collection", () => {
		it("includes non-empty evidence array for every detected challenge", () => {
			const state = makeState({ title: "Just a moment..." });
			const result = detector.analyze(state);
			for (const c of result.challenges) {
				expect(c.evidence.length).toBeGreaterThan(0);
				for (const e of c.evidence) {
					expect(typeof e).toBe("string");
					expect(e.length).toBeGreaterThan(0);
				}
			}
		});
	});

	describe("confidence ordering", () => {
		it("sorts challenges by confidence descending", () => {
			// Login URL + CAPTCHA in body → two challenges, CAPTCHA should rank higher
			const state = makeState({
				url: "https://example.com/login",
				network: { failedRequests: [{ url: "https://hcaptcha.com/challenge", status: 200 }] },
			});
			const result = detector.analyze(state);
			if (result.challenges.length > 1) {
				for (let i = 1; i < result.challenges.length; i++) {
					expect(result.challenges[i - 1]!.confidence).toBeGreaterThanOrEqual(result.challenges[i]!.confidence);
				}
			}
		});
	});
});
