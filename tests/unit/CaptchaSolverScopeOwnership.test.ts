import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CaptchaSolver,
	clearSolvers,
	registerSolver,
	trySolve,
} from "../../src/core/CaptchaSolver.js";
import { ChallengeResolver } from "../../src/core/ChallengeResolver.js";
import { setVisualReasoner, type VisualReasoner } from "../../src/core/VisualReasoner.js";

function makeSolver(name: string, token: string): CaptchaSolver {
	return {
		name,
		detect: vi.fn().mockResolvedValue({
			type: "recaptcha-v2",
			sitekey: `${name}-sitekey`,
			pageUrl: "https://example.com",
		}),
		solve: vi.fn().mockResolvedValue({ token, solver: name, durationMs: 1 }),
	};
}

function makeReasoner(name: string, answer: string): VisualReasoner {
	return {
		name,
		analyze: vi.fn().mockResolvedValue(answer),
	};
}

function makePlainPage() {
	return {
		url: () => "https://example.com",
		$: vi.fn().mockResolvedValue(null),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("page")),
		evaluate: vi.fn().mockResolvedValue(undefined),
	} as any;
}

function makeCaptchaPage() {
	const captchaElement = {
		getAttribute: vi.fn().mockResolvedValue("site-key"),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("captcha")),
	};
	return {
		url: () => "https://example.com/captcha",
		$: vi.fn(async (selector: string) => {
			if (selector.includes("data-sitekey")) return captchaElement;
			return null;
		}),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("page")),
		evaluate: vi.fn().mockResolvedValue(undefined),
	} as any;
}

afterEach(() => {
	clearSolvers();
	setVisualReasoner(null);
});

describe("captcha solver scope ownership", () => {
	it("uses an explicitly scoped solver list instead of the standalone registry", async () => {
		const globalSolver = makeSolver("global", "global-token");
		const scopedSolver = makeSolver("scoped", "scoped-token");
		registerSolver(globalSolver);

		const result = await trySolve(makePlainPage(), {
			solvers: [scopedSolver],
			getVisualReasoner: () => null,
		});

		expect(result?.token).toBe("scoped-token");
		expect(scopedSolver.detect).toHaveBeenCalledOnce();
		expect(globalSolver.detect).not.toHaveBeenCalled();
	});

	it("uses a scoped VLM provider instead of the standalone global reasoner", async () => {
		const globalReasoner = makeReasoner("global", "global-answer");
		const scopedReasoner = makeReasoner("scoped", "scoped-answer");
		setVisualReasoner(globalReasoner);

		const result = await trySolve(makeCaptchaPage(), {
			solvers: [],
			getVisualReasoner: () => scopedReasoner,
		});

		expect(result?.token).toBe("scoped-answer");
		expect(scopedReasoner.analyze).toHaveBeenCalledOnce();
		expect(globalReasoner.analyze).not.toHaveBeenCalled();
	});

	it("keeps custom solver ownership isolated across ChallengeResolver instances", async () => {
		const solverA = makeSolver("solver-a", "token-a");
		const solverB = makeSolver("solver-b", "token-b");
		const resolverA = new ChallengeResolver({
			captchaSolvers: [solverA],
			getVisualReasoner: () => null,
		});
		const resolverB = new ChallengeResolver({
			captchaSolvers: [solverB],
			getVisualReasoner: () => null,
		});

		const [outcomeA, outcomeB] = await Promise.all([
			resolverA.resolveCaptcha(makePlainPage()),
			resolverB.resolveCaptcha(makePlainPage()),
		]);

		expect(outcomeA.resolved).toBe(true);
		expect(outcomeB.resolved).toBe(true);
		expect(outcomeA.attempts[0]?.detail).toContain("solver-a");
		expect(outcomeB.attempts[0]?.detail).toContain("solver-b");
		expect(solverA.solve).toHaveBeenCalledOnce();
		expect(solverB.solve).toHaveBeenCalledOnce();
	});

	it("keeps VLM fallback ownership isolated across ChallengeResolver instances", async () => {
		const reasonerA = makeReasoner("reasoner-a", "answer-a");
		const reasonerB = makeReasoner("reasoner-b", "answer-b");
		const resolverA = new ChallengeResolver({
			captchaSolvers: [],
			getVisualReasoner: () => reasonerA,
		});
		const resolverB = new ChallengeResolver({
			captchaSolvers: [],
			getVisualReasoner: () => reasonerB,
		});

		const [outcomeA, outcomeB] = await Promise.all([
			resolverA.resolveCaptcha(makeCaptchaPage()),
			resolverB.resolveCaptcha(makeCaptchaPage()),
		]);

		expect(outcomeA.resolved).toBe(true);
		expect(outcomeB.resolved).toBe(true);
		expect(reasonerA.analyze).toHaveBeenCalledOnce();
		expect(reasonerB.analyze).toHaveBeenCalledOnce();
		expect(reasonerA.analyze).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining("answer-b"));
	});
});
