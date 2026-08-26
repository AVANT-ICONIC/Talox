import { afterEach, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import * as VisualReasoner from "../../src/core/VisualReasoner.js";

function makePage() {
	return {
		on: vi.fn(),
	} as any;
}

function bindCollectors(controller: TaloxController, count = 1) {
	const collectors = Array.from({ length: count }, () => (controller._session as any).createStateCollector(makePage()));
	controller._session.pages = collectors;
	controller._session.activePageIndex = collectors.length - 1;
	return collectors;
}

afterEach(() => {
	VisualReasoner.setVisualEmitter(null);
	VisualReasoner.setVisualReasoner(null);
});

describe("visual question response ownership", () => {
	it("rejects another controller resolving a pending question", async () => {
		const controllerA = new TaloxController();
		const controllerB = new TaloxController();
		const [collectorA] = bindCollectors(controllerA);
		bindCollectors(controllerB);
		let questionId = "";
		controllerA.on("visualQuestion", (payload) => {
			questionId = payload.id;
		});

		const answerPromise = VisualReasoner.askVisualScoped(collectorA!, Buffer.from("image"), "owned by a", 1_000);
		expect(questionId).not.toBe("");

		controllerB.resolveVisual(questionId, "wrong-controller");
		let settled = false;
		void answerPromise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		controllerA.resolveVisual(questionId, "right-controller");
		await expect(answerPromise).resolves.toBe("right-controller");
	});

	it("allows another tab from the same session to resolve the question", async () => {
		const controller = new TaloxController();
		const [originCollector] = bindCollectors(controller, 2);
		let questionId = "";
		controller.on("visualQuestion", (payload) => {
			questionId = payload.id;
		});

		const answerPromise = VisualReasoner.askVisualScoped(originCollector!, Buffer.from("image"), "cross-tab", 1_000);
		expect(questionId).not.toBe("");
		// activePageIndex points at collector #2, which shares the same session VisualScope.
		controller.resolveVisual(questionId, "same-session");

		await expect(answerPromise).resolves.toBe("same-session");
	});

	it("keeps the standalone unrestricted resolver backwards compatible", async () => {
		const owner = {};
		let questionId = "";
		VisualReasoner.setScopedVisualScope(owner, {
			emitter: (payload) => {
				questionId = payload.id;
			},
		});

		const answerPromise = VisualReasoner.askVisualScoped(owner, Buffer.from("image"), "standalone", 1_000);
		expect(questionId).not.toBe("");
		VisualReasoner.resolveVisual(questionId, "legacy-global-resolver");

		await expect(answerPromise).resolves.toBe("legacy-global-resolver");
	});
});
