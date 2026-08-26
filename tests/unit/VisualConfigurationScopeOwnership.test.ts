import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";
import { SessionManager } from "../../src/core/controller/SessionManager.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import * as VisualReasoner from "../../src/core/VisualReasoner.js";
import type { TaloxEventMap } from "../../src/types/events.js";
import { DEFAULT_SETTINGS } from "../../src/types/settings.js";

function makePage() {
	return {
		on: vi.fn(),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
	} as any;
}

function createCollector(manager: SessionManager) {
	return (manager as any).createStateCollector(makePage());
}

function makeReasoner(name: string, answer: string): VisualReasoner.VisualReasoner {
	return {
		name,
		analyze: vi.fn().mockResolvedValue(answer),
	};
}

afterEach(() => {
	VisualReasoner.setVisualEmitter(null);
	VisualReasoner.setVisualReasoner(null);
	VisualReasoner.setScreenshotFormat("base64");
});

describe("visual configuration scope ownership", () => {
	it("shares one mutable visual scope across collectors in the same session only", () => {
		const managerA = new SessionManager(
			{ ...DEFAULT_SETTINGS },
			new EventBus<TaloxEventMap>(),
			".",
		);
		const managerB = new SessionManager(
			{ ...DEFAULT_SETTINGS },
			new EventBus<TaloxEventMap>(),
			".",
		);

		const collectorA1 = createCollector(managerA);
		const collectorA2 = createCollector(managerA);
		const collectorB = createCollector(managerB);
		const scopeA1 = VisualReasoner.getScopedVisualScope(collectorA1);
		const scopeA2 = VisualReasoner.getScopedVisualScope(collectorA2);
		const scopeB = VisualReasoner.getScopedVisualScope(collectorB);

		expect(scopeA1).toBe(scopeA2);
		expect(scopeA1).not.toBe(scopeB);

		managerA.setScreenshotFormat("buffer");
		const reasonerA = makeReasoner("reasoner-a", "answer-a");
		managerA.setVisualReasoner(reasonerA);

		expect(scopeA1?.screenshotFormat).toBe("buffer");
		expect(scopeA2?.screenshotFormat).toBe("buffer");
		expect(scopeA1?.reasoner).toBe(reasonerA);
		expect(scopeA2?.reasoner).toBe(reasonerA);
		expect(scopeB?.screenshotFormat).toBeUndefined();
		expect(scopeB?.reasoner).toBeUndefined();
	});

	it("keeps controller visual reasoners isolated and preserves standalone globals", async () => {
		const controllerA = new TaloxController();
		const controllerB = new TaloxController();
		const collectorA = createCollector(controllerA._session);
		const collectorB = createCollector(controllerB._session);
		const reasonerA = makeReasoner("reasoner-a", "answer-a");
		const reasonerB = makeReasoner("reasoner-b", "answer-b");
		const globalReasoner = makeReasoner("global", "global-answer");

		VisualReasoner.setVisualReasoner(globalReasoner);
		controllerA.useVision(reasonerA);
		controllerB.useVision(reasonerB);

		const [answerA, answerB, globalAnswer] = await Promise.all([
			VisualReasoner.askVisualScoped(collectorA, Buffer.from("a"), "question-a", 0),
			VisualReasoner.askVisualScoped(collectorB, Buffer.from("b"), "question-b", 0),
			VisualReasoner.askVisual(Buffer.from("global"), "global-question", 0),
		]);

		expect(answerA).toBe("answer-a");
		expect(answerB).toBe("answer-b");
		expect(globalAnswer).toBe("global-answer");
		expect(reasonerA.analyze).toHaveBeenCalledOnce();
		expect(reasonerB.analyze).toHaveBeenCalledOnce();
		expect(globalReasoner.analyze).toHaveBeenCalledOnce();
	});

	it("keeps screenshot formats isolated across controllers", async () => {
		const controllerA = new TaloxController();
		const controllerB = new TaloxController();
		const collectorA = createCollector(controllerA._session);
		const collectorB = createCollector(controllerB._session);
		controllerA._session.pages = [collectorA];
		controllerA._session.activePageIndex = 0;
		controllerB._session.pages = [collectorB];
		controllerB._session.activePageIndex = 0;
		const formatsA: VisualReasoner.ScreenshotFormat[] = [];
		const formatsB: VisualReasoner.ScreenshotFormat[] = [];

		controllerA.on("visualQuestion", (payload) => {
			formatsA.push(payload.image.format);
			controllerA.resolveVisual(payload.id, "a");
		});
		controllerB.on("visualQuestion", (payload) => {
			formatsB.push(payload.image.format);
			controllerB.resolveVisual(payload.id, "b");
		});
		controllerA.setScreenshotFormat("buffer");
		controllerB.setScreenshotFormat("base64");

		const [answerA, answerB] = await Promise.all([
			VisualReasoner.askVisualScoped(collectorA, Buffer.from("a"), "question-a", 100),
			VisualReasoner.askVisualScoped(collectorB, Buffer.from("b"), "question-b", 100),
		]);

		expect(answerA).toBe("a");
		expect(answerB).toBe("b");
		expect(formatsA).toEqual(["buffer"]);
		expect(formatsB).toEqual(["base64"]);
		expect(VisualReasoner.getScreenshotFormat()).toBe("base64");
	});

	it("allows a session to explicitly disable a global fallback reasoner", async () => {
		const manager = new SessionManager(
			{ ...DEFAULT_SETTINGS },
			new EventBus<TaloxEventMap>(),
			".",
		);
		const inheritedCollector = createCollector(manager);
		const globalReasoner = makeReasoner("global", "global-answer");
		VisualReasoner.setVisualReasoner(globalReasoner);

		expect(
			await VisualReasoner.askVisualScoped(inheritedCollector, Buffer.from("first"), "inherits-global", 0),
		).toBe("global-answer");

		manager.setVisualReasoner(null);
		const disabledCollector = createCollector(manager);
		expect(
			await VisualReasoner.askVisualScoped(disabledCollector, Buffer.from("second"), "local-disabled", 0),
		).toBeNull();
		expect(globalReasoner.analyze).toHaveBeenCalledOnce();
	});
});
