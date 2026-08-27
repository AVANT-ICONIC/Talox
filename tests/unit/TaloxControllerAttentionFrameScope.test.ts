import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function makeCollector() {
	let closed = false;
	const close = vi.fn().mockImplementation(async () => {
		closed = true;
	});
	const page = {
		close,
		isClosed: () => closed,
	};
	return {
		collector: { getPage: () => page } as any,
		close,
		markClosed: () => {
			closed = true;
		},
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

	it("passes only the active page frame into automatic thinking behavior", async () => {
		const controller = new TaloxController(".");
		const first = makeCollector();
		const second = makeCollector();
		controller._session.pages = [first.collector, second.collector];
		controller._session.activePageIndex = 0;
		const firstFrame = controller.setAttentionFrameBox(12, 24, 240, 180);
		const thinking = vi.spyOn(controller._session, "triggerThinkingBehavior").mockResolvedValue(undefined);

		controller.switchPage(1);
		await controller.triggerThinkingBehavior();
		expect(thinking.mock.calls[0]?.[1]).toBeNull();

		controller.switchPage(0);
		await controller.triggerThinkingBehavior();
		expect(thinking.mock.calls[1]?.[1]).toEqual(firstFrame);
		expect(thinking).toHaveBeenCalledTimes(2);
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

	it("queues attention frames set after stop and binds them on relaunch", async () => {
		const controller = new TaloxController(".");
		const first = makeCollector();
		const second = makeCollector();
		controller._session.pages = [first.collector];
		controller._session.activePageIndex = 0;
		const stoppedFrame = controller.setAttentionFrameBox(20, 30, 200, 150);

		vi.spyOn(controller._session, "stop").mockImplementation(async () => {
			first.markClosed();
		});
		await controller.stop();
		expect(controller.getAttentionFrame()).toEqual(stoppedFrame);

		const relaunchedFrame = controller.setAttentionFrameBox(40, 50, 220, 170);
		expect(controller.getAttentionFrame()).toEqual(relaunchedFrame);

		vi.spyOn(controller._session, "launch").mockImplementation(async () => {
			controller._session.pages = [second.collector];
			controller._session.activePageIndex = 0;
		});
		vi.spyOn(controller._session, "getPlaywrightPage").mockReturnValue(null);

		await controller.launch("attention-frame-relaunch", "qa");

		expect(controller.getAttentionFrame()).toEqual(relaunchedFrame);
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
