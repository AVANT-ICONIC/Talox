import { describe, expect, it, vi } from "vitest";
import type { DetectedChallenge } from "../../src/core/ChallengeDetector";
import { ChallengeResolver } from "../../src/core/ChallengeResolver";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function challenge(type: DetectedChallenge["type"], overrides: Partial<DetectedChallenge> = {}): DetectedChallenge {
	return {
		type,
		confidence: 0.9,
		evidence: [`detected ${type}`],
		canRetry: true,
		requiresHuman: false,
		...overrides,
	};
}

function fastResolver() {
	return new ChallengeResolver({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ChallengeResolver", () => {
	describe("suggestStrategy", () => {
		const resolver = fastResolver();

		it("cloudflare → wait-and-settle", () => expect(resolver.suggestStrategy("cloudflare")).toBe("wait-and-settle"));
		it("captcha → human-handoff", () => expect(resolver.suggestStrategy("captcha")).toBe("human-handoff"));
		it("login-wall → human-handoff", () => expect(resolver.suggestStrategy("login-wall")).toBe("human-handoff"));
		it("consent-wall → auto-click-accept", () =>
			expect(resolver.suggestStrategy("consent-wall")).toBe("auto-click-accept"));
		it("age-gate → auto-click-accept", () => expect(resolver.suggestStrategy("age-gate")).toBe("auto-click-accept"));
		it("maintenance → backoff-retry", () => expect(resolver.suggestStrategy("maintenance")).toBe("backoff-retry"));
		it("rate-limited → backoff-retry", () => expect(resolver.suggestStrategy("rate-limited")).toBe("backoff-retry"));
		it("empty-shell-spa → wait-hydration", () =>
			expect(resolver.suggestStrategy("empty-shell-spa")).toBe("wait-hydration"));
		it("geo-block → human-handoff", () => expect(resolver.suggestStrategy("geo-block")).toBe("human-handoff"));
	});

	describe("captcha — immediate human handoff", () => {
		it("sets requiresHuman=true", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(r.requiresHuman).toBe(true);
		});

		it("sets takeoverReason=captcha-present", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(r.takeoverReason).toBe("captcha-present");
		});

		it("resolved=false (human must solve it)", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(r.resolved).toBe(false);
		});

		it("uses human-handoff strategy", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(r.finalStrategy).toBe("human-handoff");
		});
	});

	describe("login-wall — immediate human handoff", () => {
		it("sets takeoverReason=login-required", async () => {
			const r = await fastResolver().resolve(challenge("login-wall"), null);
			expect(r.takeoverReason).toBe("login-required");
		});
	});

	describe("geo-block — human handoff with policy-blocked", () => {
		it("sets takeoverReason=policy-blocked", async () => {
			const r = await fastResolver().resolve(challenge("geo-block"), null);
			expect(r.takeoverReason).toBe("policy-blocked");
		});
	});

	describe("consent-wall — auto-click-accept", () => {
		it("clicks accept button and resolves", async () => {
			const btn = { isVisible: vi.fn().mockResolvedValue(true), click: vi.fn().mockResolvedValue(undefined) };
			const page = { $: vi.fn().mockImplementation(async (sel: string) => (sel.includes("accept") ? btn : null)) };

			const r = await fastResolver().resolve(challenge("consent-wall"), page);
			expect(r.resolved).toBe(true);
			expect(r.finalStrategy).toBe("auto-click-accept");
			expect(btn.click).toHaveBeenCalled();
		});

		it("returns resolved=false if no accept button found", async () => {
			const page = { $: vi.fn().mockResolvedValue(null) };
			const r = await fastResolver().resolve(challenge("consent-wall"), page);
			expect(r.resolved).toBe(false);
		});
	});

	describe("cloudflare — wait-and-settle", () => {
		it("resolves when page title clears", async () => {
			let callCount = 0;
			const page = {
				title: vi.fn().mockImplementation(async () => {
					callCount++;
					return callCount >= 2 ? "Reddit" : "Just a moment...";
				}),
				url: vi.fn().mockReturnValue("https://reddit.com"),
			};

			const r = await fastResolver().resolve(challenge("cloudflare"), page);
			expect(r.resolved).toBe(true);
		});

		it("escalates to human if challenge persists", async () => {
			const page = {
				title: vi.fn().mockResolvedValue("Just a moment..."),
				url: vi.fn().mockReturnValue("https://example.com"),
			};

			const r = await fastResolver().resolve(challenge("cloudflare"), page);
			expect(r.resolved).toBe(false);
			expect(r.requiresHuman).toBe(true);
			expect(r.takeoverReason).toBe("challenge-unsolved");
		});
	});

	describe("rate-limited — backoff-retry", () => {
		it("resolves after successful reload", async () => {
			let reloads = 0;
			const page = {
				reload: vi.fn().mockImplementation(async () => {
					reloads++;
				}),
				title: vi.fn().mockResolvedValue("Home"),
			};

			const r = await fastResolver().resolve(challenge("rate-limited"), page);
			expect(r.resolved).toBe(true);
			expect(r.finalStrategy).toBe("backoff-retry");
		});
	});

	describe("empty-shell-spa — wait-hydration", () => {
		it("resolves when interactive elements appear", async () => {
			let calls = 0;
			const page = {
				evaluate: vi.fn().mockImplementation(async () => {
					calls++;
					return calls >= 2 ? 5 : 0; // 5 elements on second poll
				}),
			};

			const r = await new ChallengeResolver({ maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5 }).resolve(
				challenge("empty-shell-spa"),
				page,
			);
			expect(r.resolved).toBe(true);
		});

		it("fails after timeout if no elements appear", async () => {
			const page = { evaluate: vi.fn().mockResolvedValue(0) };
			const r = await new ChallengeResolver({
				maxRetries: 2,
				baseDelayMs: 1,
				maxDelayMs: 5,
				spaHydrationTimeoutMs: 50,
			}).resolve(challenge("empty-shell-spa"), page);
			expect(r.resolved).toBe(false);
			expect(r.finalStrategy).toBe("wait-hydration");
		});
	});

	describe("outcome structure", () => {
		it("every outcome includes required fields", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(typeof r.resolved).toBe("boolean");
			expect(typeof r.requiresHuman).toBe("boolean");
			expect(Array.isArray(r.attempts)).toBe(true);
			expect(typeof r.totalAttempts).toBe("number");
			expect(typeof r.finalStrategy).toBe("string");
		});

		it("attempts array is never empty", async () => {
			const r = await fastResolver().resolve(challenge("captcha"), null);
			expect(r.attempts.length).toBeGreaterThan(0);
		});

		it("totalAttempts matches attempts.length", async () => {
			const r = await fastResolver().resolve(challenge("login-wall"), null);
			expect(r.totalAttempts).toBe(r.attempts.length);
		});
	});
});
