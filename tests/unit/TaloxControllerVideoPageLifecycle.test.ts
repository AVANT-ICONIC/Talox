import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function page(id: string) {
	return { id } as any;
}

describe("TaloxController session video page lifecycle", () => {
	it("retargets a running recorder after open, switch, active-page close, and headed recreation", async () => {
		const controller = new TaloxController(".");
		const first = page("first");
		const opened = page("opened");
		const switched = page("switched");
		const survivor = page("survivor");
		const recreated = page("recreated");
		let activePage: any = first;

		const recorder = {
			isRecording: vi.fn(() => true),
			retarget: vi.fn(),
		};
		(controller as any).videoRecorder = recorder;
		vi.spyOn(controller._session, "getPlaywrightPage").mockImplementation(() => activePage);

		vi.spyOn(controller._session, "openPage").mockImplementation(async () => {
			activePage = opened;
			return { url: "https://opened.example" } as any;
		});
		await controller.openPage("https://opened.example");
		expect(recorder.retarget).toHaveBeenLastCalledWith(opened);

		vi.spyOn(controller._session, "switchPage").mockImplementation(() => {
			activePage = switched;
		});
		controller.switchPage(1);
		expect(recorder.retarget).toHaveBeenLastCalledWith(switched);

		vi.spyOn(controller._session, "closePage").mockImplementation(async () => {
			activePage = survivor;
		});
		await controller.closePage(1);
		expect(recorder.retarget).toHaveBeenLastCalledWith(survivor);

		vi.spyOn(controller._session, "setHeadedMode").mockImplementation(async () => {
			activePage = recreated;
		});
		await controller.setHeaded(true);
		expect(recorder.retarget).toHaveBeenLastCalledWith(recreated);
	});

	it("retargets to null when closing the final active page", async () => {
		const controller = new TaloxController(".");
		let activePage: any = page("only");
		const recorder = {
			isRecording: vi.fn(() => true),
			retarget: vi.fn(),
		};
		(controller as any).videoRecorder = recorder;
		vi.spyOn(controller._session, "getPlaywrightPage").mockImplementation(() => activePage);
		vi.spyOn(controller._session, "closePage").mockImplementation(async () => {
			activePage = null;
		});

		await controller.closePage(0);

		expect(recorder.retarget).toHaveBeenCalledOnce();
		expect(recorder.retarget).toHaveBeenCalledWith(null);
	});
});