import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function makeCollector() {
	const close = vi.fn().mockResolvedValue(undefined);
	return {
		collector: { getPage: () => ({ close }) } as any,
		close,
	};
}

describe("TaloxController attention frame ownership", () => {
	it("keeps attention frames isolated by active page and restores them on switch", () => {
		const controller = new TaloxController(".");
		const first = makeCollector();
		const second = makeCollector();
		controller._session.pages = [first.collector, second.collector];
		controller._session.activePageIndex = 0;

		const firstFrame = controller.setAttentionFrameBox(10, 20, 300, 200);
		controller.switchPage(1);

		expect(controller.getAttentionFrame()).toBeNull();
		const secondFrame = controller.setAttentionFrameBox(400, 50, 120, 90);

		controller.switchPage(0);
		expect(controller.getAttentionFrame()).toEqual(firstFrame);

		controller.switchPage(1);
		expect(controller.getAttentionFrame()).toEqual(secondFrame);
	});

	it("restores only the surviving page frame when the active page closes", async () => {
		const controller = new TaloxController(".");
		const first = makeCollector();
		const second = makeCollector();
		controller._session.pages = [first.collector, second.collector];
		controller._session.activePageIndex = 0;

		const firstFrame = controller.setAttentionFrameBox(5, 6, 70, 80);
		controller.switchPage(1);
		controller.setAttentionFrameBox(100, 110, 120, 130);

		await controller.closePage(1);

		expect(second.close).toHaveBeenCalledOnce();
		expect(controller.getActivePageIndex()).toBe(0);
		expect(controller.getAttentionFrame()).toEqual(firstFrame);
	});

	it("binds a pre-launch attention frame to the first launched page", async () => {
		const controller = new TaloxController(".");
		const first = makeCollector();
		const pendingFrame = controller.setAttentionFrameBox(1, 2, 30, 40);
		expect(controller.getAttentionFrame()).toEqual(pendingFrame);

		vi.spyOn(controller._session, "launch").mockImplementation(async () => {
			controller._session.pages = [first.collector];
			controller._session.activePageIndex = 0;
		});
		vi.spyOn(controller._session, "getPlaywrightPage").mockReturnValue(null);

		await controller.launch("attention-frame-test", "qa");

		expect(controller.getAttentionFrame()).toEqual(pendingFrame);
	});

	it("preserves the active page frame across headed-mode page recreation", async () => {
		const controller = new TaloxController(".");
		const before = makeCollector();
		const after = makeCollector();
		controller._session.pages = [before.collector];
		controller._session.activePageIndex = 0;
		const frame = controller.setAttentionFrameBox(8, 9, 100, 110);

		vi.spyOn(controller._session, "setHeadedMode").mockImplementation(async () => {
			controller._session.pages = [after.collector];
			controller._session.activePageIndex = 0;
		});

		await controller.setHeaded(true);

		expect(controller.getAttentionFrame()).toEqual(frame);
	});
});
