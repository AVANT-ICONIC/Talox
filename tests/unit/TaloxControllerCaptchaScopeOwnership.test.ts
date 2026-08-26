import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearSolvers,
	getSolvers,
	registerSolver,
	type CaptchaChallenge,
	type CaptchaSolver,
} from "../../src/core/CaptchaSolver.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import { setVisualReasoner, type VisualReasoner } from "../../src/core/VisualReasoner.js";

function makeCustomSolver(name: string, token: string): CaptchaSolver {
	return {
		name,
		detect: vi.fn(async () => ({
			type: "image-captcha",
			sitekey: "image",
			pageUrl: "https://example.test",
		}) satisfies CaptchaChallenge),
		solve: vi.fn(async () => ({ token, solver: name, durationMs: 1 })),
	};
}

function makeCustomSolverPage() {
	return {
		evaluate: vi.fn().mockResolvedValue(undefined),
	} as any;
}

function makeVlmCaptchaPage() {
	const captchaElement = {
		screenshot: vi.fn().mockResolvedValue(Buffer.from("captcha-image")),
	};
	return {
		on: vi.fn(),
		url: vi.fn().mockReturnValue("https://example.test/captcha"),
		$: vi.fn(async (selector: string) => {
			if (selector === "[data-sitekey]") return null;
			if (selector === ".h-captcha[data-sitekey]") return null;
			if (selector === 'img[src*="captcha"], img[id*="captcha"], img[class*="captcha"]') return captchaElement;
			if (selector === 'input[name*="captcha"], input[id*="captcha"]') return null;
			if (selector.includes("[data-sitekey], .h-captcha")) return captchaElement;
			return null;
		}),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("page-image")),
		evaluate: vi.fn().mockResolvedValue(undefined),
	} as any;
}

function bindActivePage(controller: TaloxController, page: any): void {
	const collector = (controller._session as any).createStateCollector(page);
	controller._session.pages = [collector];
	controller._session.activePageIndex = 0;
}

function makeReasoner(name: string, answer: string): VisualReasoner {
	return {
		name,
		analyze: vi.fn().mockResolvedValue(answer),
	};
}

afterEach(() => {
	clearSolvers();
	setVisualReasoner(null);
});

describe("TaloxController CAPTCHA solver ownership", () => {
	it("keeps custom solvers local to their owning controller", async () => {
		const standaloneSolver = makeCustomSolver("standalone", "global-token");
		const solverA = makeCustomSolver("solver-a", "token-a");
		const solverB = makeCustomSolver("solver-b", "token-b");
		registerSolver(standaloneSolver);

		const controllerA = new TaloxController();
		const controllerB = new TaloxController();
		controllerA.useSolver(solverA);
		controllerB.useSolver(solverB);

		expect(getSolvers()).toEqual([standaloneSolver]);

		const outcomeA = await (controllerA as any)._challengeResolver.resolveCaptcha(makeCustomSolverPage());
		const outcomeB = await (controllerB as any)._challengeResolver.resolveCaptcha(makeCustomSolverPage());

		expect(outcomeA.resolved).toBe(true);
		expect(outcomeB.resolved).toBe(true);
		expect(solverA.detect).toHaveBeenCalledOnce();
		expect(solverA.solve).toHaveBeenCalledOnce();
		expect(solverB.detect).toHaveBeenCalledOnce();
		expect(solverB.solve).toHaveBeenCalledOnce();
		expect(standaloneSolver.detect).not.toHaveBeenCalled();
	});

	it("uses each controller's scoped VisualReasoner for the built-in CAPTCHA fallback", async () => {
		const controllerA = new TaloxController();
		const controllerB = new TaloxController();
		const pageA = makeVlmCaptchaPage();
		const pageB = makeVlmCaptchaPage();
		const reasonerA = makeReasoner("reasoner-a", "alpha");
		const reasonerB = makeReasoner("reasoner-b", "beta");
		bindActivePage(controllerA, pageA);
		bindActivePage(controllerB, pageB);
		controllerA.useVision(reasonerA);
		controllerB.useVision(reasonerB);

		const outcomeA = await (controllerA as any)._challengeResolver.resolveCaptcha(pageA);
		const outcomeB = await (controllerB as any)._challengeResolver.resolveCaptcha(pageB);

		expect(outcomeA.resolved).toBe(true);
		expect(outcomeB.resolved).toBe(true);
		expect(reasonerA.analyze).toHaveBeenCalledOnce();
		expect(reasonerB.analyze).toHaveBeenCalledOnce();
		expect(outcomeA.attempts[0]?.detail).toContain("reasoner-a");
		expect(outcomeB.attempts[0]?.detail).toContain("reasoner-b");
	});

	it("does not fall back to the standalone global VisualReasoner for controller CAPTCHA resolution", async () => {
		const globalReasoner = makeReasoner("global-reasoner", "should-not-run");
		setVisualReasoner(globalReasoner);

		const controller = new TaloxController();
		const page = makeVlmCaptchaPage();
		bindActivePage(controller, page);

		const outcome = await (controller as any)._challengeResolver.resolveCaptcha(page);

		expect(outcome.resolved).toBe(false);
		expect(outcome.requiresHuman).toBe(true);
		expect(globalReasoner.analyze).not.toHaveBeenCalled();
	});

	it("useVision(null) disables a previously configured controller-local CAPTCHA reasoner", async () => {
		const controller = new TaloxController();
		const page = makeVlmCaptchaPage();
		const reasoner = makeReasoner("local-reasoner", "answer");
		bindActivePage(controller, page);
		controller.useVision(reasoner);
		controller.useVision(null);

		const outcome = await (controller as any)._challengeResolver.resolveCaptcha(page);

		expect(outcome.resolved).toBe(false);
		expect(outcome.requiresHuman).toBe(true);
		expect(reasoner.analyze).not.toHaveBeenCalled();
	});
});
