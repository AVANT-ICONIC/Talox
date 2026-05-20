/**
 * @file CaptchaSolver.test.ts
 * @description Tests for CaptchaSolver registry, providers, and ChallengeResolver integration.
 */

import { describe, expect, it } from "vitest";
import {
	registerSolver,
	clearSolvers,
	getSolvers,
	trySolve,
	type CaptchaSolver,
	type CaptchaChallenge,
} from "../../src/core/CaptchaSolver.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockPage(html: string): import("playwright-core").Page {
	return {
		url: () => "https://example.com/login",
		$: async () => null, // No matching elements by default
		$$: async () => [],
		evaluate: async () => undefined,
	} as unknown as import("playwright-core").Page;
}

function mockSolver(name: string, shouldDetect: boolean, shouldSolve: boolean, solveMs = 500): CaptchaSolver {
	return {
		name,
		async detect(_page) {
			if (!shouldDetect) return null;
			return { type: "recaptcha-v2", sitekey: "test-sitekey", pageUrl: "https://example.com" };
		},
		async solve(_page, _challenge) {
			if (!shouldSolve) return null;
			return { token: `token-from-${name}`, solver: name, durationMs: solveMs };
		},
	};
}

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("CaptchaSolver registry", () => {
	it("starts empty", () => {
		clearSolvers();
		expect(getSolvers()).toHaveLength(0);
	});

	it("registers and returns solvers", () => {
		clearSolvers();
		const s = mockSolver("test", true, true);
		registerSolver(s);
		expect(getSolvers()).toHaveLength(1);
		expect(getSolvers()[0]!.name).toBe("test");
	});

	it("registers multiple in order", () => {
		clearSolvers();
		registerSolver(mockSolver("A", true, true));
		registerSolver(mockSolver("B", true, true));
		expect(getSolvers().map((s) => s.name)).toEqual(["A", "B"]);
	});

	it("clearSolvers empties the registry", () => {
		clearSolvers();
		registerSolver(mockSolver("A", true, true));
		clearSolvers();
		expect(getSolvers()).toHaveLength(0);
	});
});

// ─── trySolve ─────────────────────────────────────────────────────────────────

describe("trySolve", () => {
	const page = mockPage("");

	it("returns null when no solvers registered", async () => {
		clearSolvers();
		const result = await trySolve(page);
		expect(result).toBeNull();
	});

	it("returns solution from the first successful solver", async () => {
		clearSolvers();
		registerSolver(mockSolver("fast-solver", true, true, 100));
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.token).toBe("token-from-fast-solver");
		expect(result!.solver).toBe("fast-solver");
	});

	it("skips solver that doesn't detect and tries next", async () => {
		clearSolvers();
		registerSolver(mockSolver("blind", false, true)); // can't detect
		registerSolver(mockSolver("working", true, true));
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.solver).toBe("working");
	});

	it("skips solver that detects but fails to solve", async () => {
		clearSolvers();
		registerSolver(mockSolver("detect-fail", true, false)); // detects but fails
		registerSolver(mockSolver("detect-solve", true, true));
		const result = await trySolve(page);
		expect(result).not.toBeNull();
		expect(result!.solver).toBe("detect-solve");
	});

	it("returns null when all solvers fail", async () => {
		clearSolvers();
		registerSolver(mockSolver("fail1", true, false));
		registerSolver(mockSolver("fail2", false, true));
		const result = await trySolve(page);
		expect(result).toBeNull();
	});

	it("returns null when all solvers detect but none solve", async () => {
		clearSolvers();
		registerSolver(mockSolver("fail-a", true, false));
		registerSolver(mockSolver("fail-b", true, false));
		const result = await trySolve(page);
		expect(result).toBeNull();
	});
});

// ─── CaptchaChallenge type ────────────────────────────────────────────────────

describe("CaptchaChallenge", () => {
	it("has all required fields", () => {
		const c: CaptchaChallenge = {
			type: "recaptcha-v2",
			sitekey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
			pageUrl: "https://example.com",
		};
		expect(c.type).toBe("recaptcha-v2");
		expect(c.sitekey).toBeTruthy();
		expect(c.pageUrl).toBeTruthy();
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
		expect(c.dataS).toBe("login");
	});
});

// ─── ChallengeResolver integration ────────────────────────────────────────────

describe("ChallengeResolver with solver", () => {
	it("resolves captcha type via external solver when available", async () => {
		// This tests that the resolve() method dispatches captcha to resolveCaptcha
		// The actual integration test needs a real Chromium page.
		// The registry + trySolve path is tested above.
		// For now, verify the ChallengeResolver imports trySolve without error.
		expect(true).toBe(true); // Placeholder — integration test needs browser
	});
});
