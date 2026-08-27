import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function page(id: string) {
	return { id } as any;
}

describe("TaloxController cross-origin manager page lifecycle", () => {
	it("reinstalls the manager after open, switch, active close, and headed recreation", async () => {
		const controller = new TaloxController(".");
		controller.settings.enableCrossOriginIframes = true;
		const opened = page("opened");
		const switched = page("switched");
		const survivor = page("survivor");
		const recreated = page("recreated");
		let activePage: any = page("initial");
		const manager = { install: vi.fn(), dispose: vi.fn() };
		(controller as any).crossOriginManager = manager;

		vi.spyOn(controller._session, "getPlaywrightPage").mockImplementation(() => activePage);
		vi.spyOn(controller._session, "openPage").mockImplementation(async () => {
			activePage = opened;
			return { url: "https://opened.example" } as any;
		});
		await controller.openPage("https://opened.example");
		expect(manager.install).toHaveBeenLastCalledWith(opened);

		vi.spyOn(controller._session, "switchPage").mockImplementation(() => {
			activePage = switched;
		});
		controller.switchPage(1);
		expect(manager.install).toHaveBeenLastCalledWith(switched);

		vi.spyOn(controller._session, "closePage").mockImplementation(async () => {
			activePage = survivor;
		});
		await controller.closePage(1);
		expect(manager.install).toHaveBeenLastCalledWith(survivor);

		vi.spyOn(controller._session, "setHeadedMode").mockImplementation(async () => {
			activePage = recreated;
		});
		await controller.setHeaded(true);
		expect(manager.install).toHaveBeenLastCalledWith(recreated);
	});

	it("disposes the manager after the final page closes", async () => {
		const controller = new TaloxController(".");
		controller.settings.enableCrossOriginIframes = true;
		let activePage: any = page("only");
		const manager = { install: vi.fn(), dispose: vi.fn() };
		(controller as any).crossOriginManager = manager;
		vi.spyOn(controller._session, "getPlaywrightPage").mockImplementation(() => activePage);
		vi.spyOn(controller._session, "closePage").mockImplementation(async () => {
			activePage = null;
		});

		await controller.closePage(0);

		expect(manager.dispose).toHaveBeenCalledOnce();
		expect((controller as any).crossOriginManager).toBeNull();
	});
});