/**
 * @file CaptchaSolver.test.ts
 * @description Tests for CaptchaSolver — VLM-based solving, registry, and custom solvers.
 */

import { describe, expect, it } from "vitest";
import {
	registerSolver,
	clearSolvers,
	getSolvers,
	trySolve,
	createVLMCaptchaSolver,
	type CaptchaSolver,
	type CaptchaChallenge,
} from "../../src/core/CaptchaSolver.js";
import { setVisualReasoner, type VisualReasoner } from "../../src/core/VisualReasoner.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockPage(html: string): import("playwright-core").Page {
	return {
		url: () => "https://example.com/login",
		$: async () => null,
		screenshot: async () => Buffer.from("fake-png"),
		evaluate: async () => undefined,
	} as unknown as import("playwright-core").Page;
}

function mockPageWithRecaptcha(sitekey = "test-sitekey"): import("playwright-core").Page {
	return {
		url: () => "https://example.com/login",
		$: async (sel: string) => {
			if (sel.includes("data-sitekey")) {
				return { getAttribute: async () => sitekey } as unknown as import("playwright-core").ElementHandle;
			}
			return null;
		},
		screenshot: async () => Buffer.from("fake-captcha-png"),
		evaluate: async () => undefined,
	} as unknown as import("playwright-core").Page;
}

function mockVLM(answers: Record<string, string>): VisualReasoner {
	return {
		name: "mock-vlm",
		analyze: async (_screenshot, question) => {
			for (const [key, val] of Object.entries(answers)) {
				if (question.includes(key)) return val;
			}
			return "P4SSW0RD";
		},
	};
}

function mockSolver(name: string, shouldDetect: boolean, shouldSolve: boolean): CaptchaSolver {
	return {
		name,
		async detect(_page) {
			if (!shouldDetect) return null;
			return { type: "recaptcha-v2", sitekey: "custom-sitekey", pageUrl: "https://example.com" };
		},
		async solve(_page, _challenge) {
			if (!shouldSolve) return null;
			return { token: `token-from-${name}`, solver: name, durationMs: 100 };
		},
	};
}

// ─── VLM-based Solver ─────────────────────────────────────────────────────────

describe("createVLMCaptchaSolver", () => {
	it("detects reCAPTCHA via data-sitekey", async () => {
		setVisualReasoner(mockVLM({}));
		const solver = createVLMCaptchaSolver();
		const page = mockPageWithRecaptcha();
		const ch = await solver.detect(page);
		expect(ch).not.toBeNull();
		expect(ch!.type).toBe("recaptcha-v2");
		expect(ch!.sitekey).toBe("test-sitekey");
	});

	it("returns null when no captcha on page", async () => {
		const solver = createVLMCaptchaSolver();
		const page = mockPage("");
		const ch = await solver.detect(page);
		expect(ch).toBeNull();
	});

	it("uses VLM to solve an image captcha", async () => {
		const vlm = mockVLM({ CAPTCHA: "X9K2M" });
		setVisualReasoner(vlm);
		const solver = createVLMCaptchaSolver();
		const page = mockPage("");
		const ch: CaptchaChallenge = { type: "image-captcha", sitekey: "img", pageUrl: "https://x.com" };
		const result = await solver.solve(page, ch);
		expect(result).not.toBeNull();
		expect(result!.token).toBe("X9K2M");
		expect(result!.solver).toContain("Talox VLM");
	});

	it("returns null when no VLM is registered", async () => {
		setVisualReasoner(null);
		const solver = createVLMCaptchaSolver();
		const page = mockPage("");
		const ch: CaptchaChallenge = { type: "text-captcha", sitekey: "text", pageUrl: "https://x.com" };
		const result = await solver.solve(page, ch);
		expect(result).toBeNull();
	});

	it("returns null when VLM returns null", async () => {
		const vlm: VisualReasoner = { name: "silent", analyze: async () => null };
		setVisualReasoner(vlm);
		const solver = createVLMCaptchaSolver();
		const page = mockPage("");
		const ch: CaptchaChallenge = { type: "text-captcha", sitekey: "text", pageUrl: "https://x.com" };
		const result = await solver.solve(page, ch);
		expect(result).toBeNull();
	});
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("CaptchaSolver registry", () => {
	it("starts empty", () => {
		clearSolvers();
		expect(getSolvers()).toHaveLength(0);
	});

	it("registers and returns solvers in order", () => {
		clearSolvers();
		registerSolver(mockSolver("A", true, true));
		registerSolver(mockSolver("B", true, true));
		expect(getSolvers().map((s) => s.name)).toEqual(["A", "B"]);
	});

	it("clearSolvers empties the registry", () => {
		clearSolvers();
		registerSolver(mockSolver("X", true, true));
		clearSolvers();
		expect(getSolvers()).toHaveLength(0);
	});
});

// ─── trySolve ─────────────────────────────────────────────────────────────────

describe("trySolve", () => {
	const page = mockPage("");

	it("uses VLM solver when no custom solvers registered", async () => {
		clearSolvers();
		setVisualReasoner(mockVLM({ CAPTCHA: "ABC123" }));
		const page = mockPageWithRecaptcha();
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.solver).toContain("Talox VLM");
	});

	it("returns null when VLM not registered and no custom solvers", async () => {
		clearSolvers();
		setVisualReasoner(null);
		// page has no captcha elements, so VLM solver can't detect anything
		const result = await trySolve(page);
		expect(result).toBeNull();
	});

	it("prefers custom solver over VLM fallback", async () => {
		clearSolvers();
		setVisualReasoner(mockVLM({}));
		registerSolver(mockSolver("custom", true, true));
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.solver).toBe("custom"); // custom tried first
	});

	it("falls back to VLM when custom solver fails", async () => {
		clearSolvers();
		setVisualReasoner(mockVLM({ CAPTCHA: "FALLBACK" }));
		registerSolver(mockSolver("failer", true, false)); // detects but fails to solve
		const page = mockPageWithRecaptcha();
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.token).toBe("FALLBACK");
	});
});

// ─── CaptchaChallenge type ────────────────────────────────────────────────────

describe("CaptchaChallenge", () => {
	it("has required fields", () => {
		const c: CaptchaChallenge = {
			type: "recaptcha-v2",
			sitekey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
			pageUrl: "https://example.com",
		};
		expect(c.type).toBe("recaptcha-v2");
		expect(c.sitekey).toBeTruthy();
	});

	it("supports optional fields", () => {
		const c: CaptchaChallenge = {
			type: "hcaptcha",
			sitekey: "test",
			pageUrl: "https://example.com",
			invisible: true,
			dataS: "login",
		};
		expect(c.invisible).toBe(true);
	});
});
